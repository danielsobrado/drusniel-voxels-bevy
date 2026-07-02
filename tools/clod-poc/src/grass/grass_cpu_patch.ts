import * as THREE from "three";
import type { PageFootprint } from "../types.js";
import { getDigEditRevision, surfaceHeight } from "../terrain/terrain.js";
import {
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG,
  type VegetationTerrainRejectionDecision,
  type VegetationTerrainRejectionReason,
} from "../vegetation/terrain_rejection_config.js";
import { VegetationTerrainRejectionCache } from "../vegetation/terrain_rejection_cache.js";
import {
  TWO_PI,
  type GrassSettings,
} from "./grass_config.js";
import { getGrassMaterialBias } from "./grass_material_bias.js";
import type { GrassGenerationStats } from "./grass_stats.js";
import { acceptsGrassCandidate, hash2, randomSigned, sampleGrassTerrainSite } from "./grass_math.js";

export interface GrassBladeInstance {
  offset: [number, number, number];
  height: number;
  rotationY: number;
  phase: number;
  colorMix: number;
  edgeFade: number;
  normalY: number;
  terrainNormal: [number, number, number];
  widthScale?: number;
}

interface FootprintProbe {
  x: number;
  z: number;
}

const GRASS_TERRAIN_REJECTION_CACHE = new VegetationTerrainRejectionCache();

export function clearGrassTerrainRejectionCache(): void {
  GRASS_TERRAIN_REJECTION_CACHE.clear();
}

export function edgeFadeForCandidate(x: number, z: number, height: number, normalY: number, spacing: number): number {
  const sampleDistance = Math.max(0.75, spacing * 1.25);
  const samples = [
    surfaceHeight(x + sampleDistance, z),
    surfaceHeight(x - sampleDistance, z),
    surfaceHeight(x, z + sampleDistance),
    surfaceHeight(x, z - sampleDistance),
  ];
  const maxDelta = samples.reduce((max, neighbor) => Math.max(max, Math.abs(neighbor - height)), 0);
  const heightFade = 1 - THREE.MathUtils.smoothstep(maxDelta, 1.5, 4.5);
  const slopeFade = THREE.MathUtils.smoothstep(normalY, 0.55, 0.9);
  return THREE.MathUtils.clamp(heightFade * slopeFade, 0, 1);
}

export function generateGrassInstances(
  footprint: PageFootprint,
  settings: GrassSettings,
  maxBlades = settings.maxBlades,
  stats?: GrassGenerationStats,
): GrassBladeInstance[] {
  const earlyDecision = rejectGrassPatchBeforeGeneration(footprint, settings);
  if (earlyDecision.reject) {
    recordGrassEarlyRejection(stats, earlyDecision);
    return [];
  }

  const rankedInstances: { priority: number; instance: GrassBladeInstance }[] = [];
  const spacing = Math.max(0.05, settings.bladeSpacing);
  const jitter = settings.placement.jitter;
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  const limit = Math.max(0, Math.floor(maxBlades));
  const terrainPatchMode = settings.shaderMode !== "classic";

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (stats) stats.generatedCandidates++;
      const gridX = Math.floor(footprint.minX / spacing) + column;
      const gridZ = Math.floor(footprint.minZ / spacing) + row;
      const baseX = footprint.minX + (column + 0.5) * spacing;
      const baseZ = footprint.minZ + (row + 0.5) * spacing;
      const x = THREE.MathUtils.clamp(
        baseX + randomSigned(gridX, gridZ, settings.seed + 101) * spacing * jitter,
        footprint.minX + 0.001,
        footprint.maxX - 0.001,
      );
      const z = THREE.MathUtils.clamp(
        baseZ + randomSigned(gridX, gridZ, settings.seed + 211) * spacing * jitter,
        footprint.minZ + 0.001,
        footprint.maxZ - 0.001,
      );
      const site = sampleGrassTerrainSite(x, z, settings);
      if (!acceptsGrassCandidate(settings, {
        height: site.height,
        normalY: site.normalY,
        grassWeight: site.grassMask,
        waterDepth: site.waterDepth,
        rockWeight: site.rockWeight,
        snowWeight: site.snowWeight,
        threshold: hash2(gridX, gridZ, settings.seed + 307),
      })) continue;
      const edgeFade = terrainPatchMode ? edgeFadeForCandidate(x, z, site.height, site.normalY, spacing) : 1;
      if (terrainPatchMode && edgeFade < 0.18) {
        if (stats) stats.edgeSuppressedCandidates++;
        continue;
      }
      if (stats) stats.acceptedCandidates++;

      const heightScale = Math.max(
        0.1,
        1 + randomSigned(gridX, gridZ, settings.seed + 401) * settings.bladeHeightVariation,
      );
      rankedInstances.push({
        priority: hash2(gridX, gridZ, settings.seed + 809),
        instance: {
          offset: [x, site.height + 0.02, z],
          height: settings.bladeHeight * heightScale,
          rotationY: hash2(gridX, gridZ, settings.seed + 503) * TWO_PI,
          phase: hash2(gridX, gridZ, settings.seed + 601) * TWO_PI,
          colorMix: Math.min(1, Math.pow(hash2(gridX, gridZ, settings.seed + 701), 2) + site.wetBank * 0.16 + site.sandWeight * 0.12),
          edgeFade,
          normalY: site.normalY,
          terrainNormal: site.terrainNormal,
        },
      });
    }
  }
  rankedInstances.sort((a, b) => a.priority - b.priority);
  return rankedInstances.slice(0, limit).map(({ instance }) => instance);
}

function rejectGrassPatchBeforeGeneration(
  footprint: PageFootprint,
  settings: GrassSettings,
): VegetationTerrainRejectionDecision {
  if (!DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.enabled || !DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled) {
    return accept("disabled");
  }
  const key = grassRejectionCacheKey(footprint, settings);
  if (DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheEnabled) {
    const cached = GRASS_TERRAIN_REJECTION_CACHE.get(key);
    if (cached) return cached;
  }

  const decision = evaluateGrassPatchBeforeGeneration(footprint, settings);
  if (DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheEnabled) {
    GRASS_TERRAIN_REJECTION_CACHE.set(key, decision);
  }
  return decision;
}

function evaluateGrassPatchBeforeGeneration(
  footprint: PageFootprint,
  settings: GrassSettings,
): VegetationTerrainRejectionDecision {
  const probes = footprintProbes(footprint);
  const rejectingReasons: VegetationTerrainRejectionReason[] = [];
  for (const probe of probes) {
    const reason = staticGrassRejectReason(probe, settings);
    if (!reason) return accept("accepted");
    if (reason === "unknown_kept") return accept("unknown_kept");
    rejectingReasons.push(reason);
  }
  return reject(rejectingReasons[0] ?? "wrong_biome", footprint, settings);
}

function staticGrassRejectReason(probe: FootprintProbe, settings: GrassSettings): VegetationTerrainRejectionReason | null {
  const site = sampleGrassTerrainSite(probe.x, probe.z, settings);
  if (!Number.isFinite(site.height) || !Number.isFinite(site.normalY)) return "unknown_kept";
  if (site.waterDepth > 0) return "below_water";
  if (site.normalY < settings.slopeMinY) return "too_steep";
  if (site.height < settings.minHeight || site.height > settings.maxHeight) return "height_range";
  if (site.rockWeight >= 0.82 || site.snowWeight >= 0.55 || site.grassMask <= settings.placement.minGrassWeight) return "wrong_biome";
  return null;
}

function recordGrassEarlyRejection(stats: GrassGenerationStats | undefined, decision: VegetationTerrainRejectionDecision): void {
  if (!stats) return;
  stats.earlyTerrainRejectedPatches = (stats.earlyTerrainRejectedPatches ?? 0) + 1;
  stats.earlyTerrainSkippedCandidates = (stats.earlyTerrainSkippedCandidates ?? 0) + Math.max(0, Math.floor(decision.skippedCandidateEstimate));
  stats.earlyTerrainReasonCounts ??= {};
  stats.earlyTerrainReasonCounts[decision.reason] = (stats.earlyTerrainReasonCounts[decision.reason] ?? 0) + 1;
}

function estimateGrassPatchCandidateCount(footprint: PageFootprint, settings: GrassSettings): number {
  const spacing = Math.max(0.05, settings.bladeSpacing);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  return columns * rows;
}

function grassRejectionCacheKey(footprint: PageFootprint, settings: GrassSettings): string {
  return [
    "grass",
    getDigEditRevision(),
    footprint.minX.toFixed(2),
    footprint.minZ.toFixed(2),
    footprint.maxX.toFixed(2),
    footprint.maxZ.toFixed(2),
    settings.bladeSpacing,
    settings.slopeMinY,
    settings.minHeight,
    settings.maxHeight,
    settings.placement.minGrassWeight,
    JSON.stringify(getGrassMaterialBias(settings)),
  ].join(":");
}

function reject(reason: VegetationTerrainRejectionReason, footprint: PageFootprint, settings: GrassSettings): VegetationTerrainRejectionDecision {
  return {
    reject: true,
    reason,
    skippedCandidateEstimate: estimateGrassPatchCandidateCount(footprint, settings),
  };
}

function accept(reason: VegetationTerrainRejectionReason): VegetationTerrainRejectionDecision {
  return { reject: false, reason, skippedCandidateEstimate: 0 };
}

function footprintProbes(footprint: PageFootprint): FootprintProbe[] {
  const center = { x: (footprint.minX + footprint.maxX) * 0.5, z: (footprint.minZ + footprint.maxZ) * 0.5 };
  return dedupeProbes([
    center,
    { x: footprint.minX, z: footprint.minZ },
    { x: footprint.minX, z: footprint.maxZ },
    { x: footprint.maxX, z: footprint.minZ },
    { x: footprint.maxX, z: footprint.maxZ },
  ]);
}

function dedupeProbes(probes: FootprintProbe[]): FootprintProbe[] {
  const result: FootprintProbe[] = [];
  const seen = new Set<string>();
  for (const probe of probes) {
    const key = `${probe.x.toFixed(4)}|${probe.z.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(probe);
  }
  return result;
}
