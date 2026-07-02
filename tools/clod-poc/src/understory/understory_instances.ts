import * as THREE from "three";
import { getDigEditRevision, terrainWeights, surfaceHeight, surfaceNormal } from "../terrain/terrain.js";
import type { PageFootprint } from "../types.js";
import {
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG,
  type VegetationTerrainRejectionDecision,
  type VegetationTerrainRejectionReason,
} from "../vegetation/terrain_rejection_config.js";
import { VegetationTerrainRejectionCache } from "../vegetation/terrain_rejection_cache.js";
import {
  UNDERSTORY_CLASSES,
  type UnderstoryClass,
  type UnderstorySettings,
  type UnderstoryTerrainClassWeights,
} from "./understory_config.js";
import {
  sampleUnderstoryEcology,
  understoryClassWeight,
  type TreeInfluenceSampler,
  type UnderstoryEcologySample,
} from "./understory_ecology.js";
import { understoryHash2, understoryRandomSigned } from "./understory_hash.js";

export interface UnderstoryTerrainSampler {
  surfaceHeight(x: number, z: number): number;
  surfaceNormal(x: number, z: number): [number, number, number];
  materialWeights(height: number, normalY: number): [number, number, number, number];
  treeInfluence?: TreeInfluenceSampler;
}

export interface UnderstoryInstance {
  classId: UnderstoryClass;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  windPhase: number;
  normalY: number;
  ecology: UnderstoryEcologySample;
}

export interface UnderstoryGenerationStats {
  generatedCandidates: number;
  acceptedCandidates: number;
  rejectedSlope: number;
  rejectedHeight: number;
  rejectedMaterial: number;
  rejectedEcology: number;
  rejectedSpacing: number;
  acceptedShrub: number;
  acceptedFern: number;
  acceptedSapling: number;
  acceptedFlower: number;
  acceptedDeadLog: number;
  acceptedStump: number;
  earlyTerrainRejectedPatches?: number;
  earlyTerrainSkippedCandidates?: number;
  earlyTerrainReasonCounts?: Partial<Record<VegetationTerrainRejectionReason, number>>;
}

interface FootprintProbe {
  x: number;
  z: number;
}

const UNDERSTORY_TERRAIN_REJECTION_CACHE = new VegetationTerrainRejectionCache();

export const defaultUnderstoryTerrainSampler: UnderstoryTerrainSampler = {
  surfaceHeight,
  surfaceNormal,
  materialWeights: terrainWeights,
  // Note: when hydrology is active, surfaceHeight() returns the carved bed via terrainSurfaceOverride.
  // The GPU compute shader (understory_ring.compute.wgsl) uses surfaceHeightField() which is the
  // base procedural terrain without hydrology carving. This creates a CPU/GPU height mismatch in
  // hydrology regions. See TODO in understory_ring.compute.wgsl for the fix.
};

export function emptyUnderstoryGenerationStats(): UnderstoryGenerationStats {
  return {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    rejectedSlope: 0,
    rejectedHeight: 0,
    rejectedMaterial: 0,
    rejectedEcology: 0,
    rejectedSpacing: 0,
    acceptedShrub: 0,
    acceptedFern: 0,
    acceptedSapling: 0,
    acceptedFlower: 0,
    acceptedDeadLog: 0,
    acceptedStump: 0,
  };
}

export function generateUnderstoryInstances(
  footprint: PageFootprint,
  settings: UnderstorySettings,
  capacityLeft = settings.maxInstances,
  stats: UnderstoryGenerationStats = emptyUnderstoryGenerationStats(),
  sampler: UnderstoryTerrainSampler = defaultUnderstoryTerrainSampler,
  worldCells = Number.POSITIVE_INFINITY,
): UnderstoryInstance[] {
  const earlyDecision = rejectUnderstoryPatchBeforeGeneration(footprint, settings, sampler, worldCells);
  if (earlyDecision.reject) {
    recordUnderstoryEarlyRejection(stats, earlyDecision);
    return [];
  }

  const spacing = Math.max(0.25, settings.placement.spacingM);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  const limit = Math.max(0, Math.floor(capacityLeft));
  const ranked: { priority: number; spacingRadius: number; instance: UnderstoryInstance }[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      stats.generatedCandidates++;
      const gridX = Math.floor(footprint.minX / spacing) + column;
      const gridZ = Math.floor(footprint.minZ / spacing) + row;
      const baseX = footprint.minX + (column + 0.5) * spacing;
      const baseZ = footprint.minZ + (row + 0.5) * spacing;
      const x = THREE.MathUtils.clamp(
        baseX + understoryRandomSigned(gridX, gridZ, settings.seed + 101) * spacing * settings.placement.jitter,
        footprint.minX + 0.001,
        Math.min(footprint.maxX, worldCells) - 0.001,
      );
      const z = THREE.MathUtils.clamp(
        baseZ + understoryRandomSigned(gridX, gridZ, settings.seed + 211) * spacing * settings.placement.jitter,
        footprint.minZ + 0.001,
        Math.min(footprint.maxZ, worldCells) - 0.001,
      );
      if (x < 0 || z < 0 || x > worldCells || z > worldCells) {
        stats.rejectedMaterial++;
        continue;
      }

      const height = sampler.surfaceHeight(x, z);
      const normalY = sampler.surfaceNormal(x, z)[1];
      if (normalY < settings.placement.slopeMinY) {
        stats.rejectedSlope++;
        continue;
      }
      if (height < settings.placement.minHeightM || height > settings.placement.maxHeightM) {
        stats.rejectedHeight++;
        continue;
      }

      const weights = sampler.materialWeights(height, normalY);
      const terrainBias = understoryTerrainBias(weights, settings);
      const groundWeight = (weights[0] + weights[1] * 0.25) * terrainBias.density;
      if (groundWeight < settings.placement.minGroundWeight) {
        stats.rejectedMaterial++;
        continue;
      }

      const ecology = sampleUnderstoryEcology(x, z, height, normalY, groundWeight, settings, sampler.treeInfluence);
      if (ecology.forestInfluence < settings.placement.minTreeInfluence) {
        stats.rejectedEcology++;
        continue;
      }
      const acceptance = THREE.MathUtils.clamp(
        0.06 + ecology.density * 0.42 + ecology.forestInfluence * 0.28 + ecology.forestEdge * 0.22 + ecology.clearing * 0.12,
        0,
        1,
      );
      if (understoryHash2(gridX, gridZ, settings.seed + 307) > acceptance) {
        stats.rejectedEcology++;
        continue;
      }

      const cls = selectUnderstoryClass(
        ecology,
        height,
        normalY,
        settings,
        understoryHash2(gridX, gridZ, settings.seed + 409),
        terrainBias,
      );
      if (!cls) {
        stats.rejectedEcology++;
        continue;
      }
      const classDensity = settings.classes[cls].density;
      if (understoryHash2(gridX, gridZ, settings.seed + 509) > Math.min(1, classDensity)) {
        stats.rejectedEcology++;
        continue;
      }

      const spacingRadius = classSpacingRadius(cls, spacing);
      if (ranked.some(({ instance, spacingRadius: acceptedRadius }) => {
        const dx = instance.position[0] - x;
        const dz = instance.position[2] - z;
        const radius = Math.max(spacingRadius, acceptedRadius);
        return dx * dx + dz * dz < radius * radius;
      })) {
        stats.rejectedSpacing++;
        continue;
      }

      const config = settings.classes[cls];
      const scale = THREE.MathUtils.lerp(config.minScale, config.maxScale, understoryHash2(gridX, gridZ, settings.seed + 601));
      const instance: UnderstoryInstance = {
        classId: cls,
        position: [x, height, z],
        rotationY: understoryHash2(gridX, gridZ, settings.seed + 701) * Math.PI * 2,
        scale,
        windPhase: understoryHash2(gridX, gridZ, settings.seed + 809) * Math.PI * 2,
        normalY,
        ecology,
      };
      ranked.push({
        priority: understoryHash2(gridX, gridZ, settings.seed + 907),
        spacingRadius,
        instance,
      });
      stats.acceptedCandidates++;
      incrementClassStats(stats, cls);
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  return ranked.slice(0, limit).map(({ instance }) => instance);
}

export function selectUnderstoryClass(
  ecology: UnderstoryEcologySample,
  height: number,
  normalY: number,
  settings: UnderstorySettings,
  roll: number,
  terrainBias: UnderstoryTerrainClassWeights = defaultClassBias(),
): UnderstoryClass | null {
  const weights = UNDERSTORY_CLASSES.map((classId) => ({
    classId,
    weight: understoryClassWeight(classId, ecology, height, normalY, settings) * terrainBias[classId],
  }));
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let cursor = roll * total;
  for (const entry of weights) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.classId;
  }
  return weights[weights.length - 1]?.classId ?? null;
}

export function understoryTerrainBias(
  weights: readonly [number, number, number, number],
  settings: UnderstorySettings,
): UnderstoryTerrainClassWeights {
  return blendTerrainBias([
    [settings.terrain.grass, weights[0]],
    [settings.terrain.rock, weights[1]],
    [settings.terrain.sand, weights[2]],
    [settings.terrain.snow, weights[3]],
  ]);
}

function rejectUnderstoryPatchBeforeGeneration(
  footprint: PageFootprint,
  settings: UnderstorySettings,
  sampler: UnderstoryTerrainSampler,
  worldCells: number,
): VegetationTerrainRejectionDecision {
  if (!DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.enabled || !DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled) {
    return accept("disabled");
  }
  const key = understoryRejectionCacheKey(footprint, settings);
  if (DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheEnabled) {
    const cached = UNDERSTORY_TERRAIN_REJECTION_CACHE.get(key);
    if (cached) return cached;
  }
  const decision = evaluateUnderstoryPatchBeforeGeneration(footprint, settings, sampler, worldCells);
  if (DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheEnabled) {
    UNDERSTORY_TERRAIN_REJECTION_CACHE.set(key, decision);
  }
  return decision;
}

function evaluateUnderstoryPatchBeforeGeneration(
  footprint: PageFootprint,
  settings: UnderstorySettings,
  sampler: UnderstoryTerrainSampler,
  worldCells: number,
): VegetationTerrainRejectionDecision {
  const probes = footprintProbes(footprint);
  const rejectingReasons: VegetationTerrainRejectionReason[] = [];
  for (const probe of probes) {
    const reason = staticUnderstoryRejectReason(probe, settings, sampler, worldCells);
    if (!reason) return accept("accepted");
    rejectingReasons.push(reason);
  }
  return reject(rejectingReasons[0] ?? "wrong_biome", footprint, settings);
}

function staticUnderstoryRejectReason(
  probe: FootprintProbe,
  settings: UnderstorySettings,
  sampler: UnderstoryTerrainSampler,
  worldCells: number,
): VegetationTerrainRejectionReason | null {
  if (probe.x < 0 || probe.z < 0 || probe.x > worldCells || probe.z > worldCells) return "outside_world";
  const height = sampler.surfaceHeight(probe.x, probe.z);
  if (!Number.isFinite(height)) return "unknown_kept";
  const normalY = sampler.surfaceNormal(probe.x, probe.z)[1];
  if (!Number.isFinite(normalY)) return "unknown_kept";
  if (normalY < settings.placement.slopeMinY) return "too_steep";
  if (height < settings.placement.minHeightM || height > settings.placement.maxHeightM) return "height_range";
  const weights = sampler.materialWeights(height, normalY);
  const terrainBias = understoryTerrainBias(weights, settings);
  const groundWeight = (weights[0] + weights[1] * 0.25) * terrainBias.density;
  if (groundWeight < settings.placement.minGroundWeight) return "wrong_biome";
  return null;
}

function recordUnderstoryEarlyRejection(stats: UnderstoryGenerationStats, decision: VegetationTerrainRejectionDecision): void {
  stats.earlyTerrainRejectedPatches = (stats.earlyTerrainRejectedPatches ?? 0) + 1;
  stats.earlyTerrainSkippedCandidates = (stats.earlyTerrainSkippedCandidates ?? 0) + Math.max(0, Math.floor(decision.skippedCandidateEstimate));
  stats.earlyTerrainReasonCounts ??= {};
  stats.earlyTerrainReasonCounts[decision.reason] = (stats.earlyTerrainReasonCounts[decision.reason] ?? 0) + 1;
}

function estimateUnderstoryPatchCandidateCount(footprint: PageFootprint, settings: UnderstorySettings): number {
  const spacing = Math.max(0.25, settings.placement.spacingM);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  return columns * rows;
}

function understoryRejectionCacheKey(footprint: PageFootprint, settings: UnderstorySettings): string {
  return [
    "understory",
    getDigEditRevision(),
    footprint.minX.toFixed(2),
    footprint.minZ.toFixed(2),
    footprint.maxX.toFixed(2),
    footprint.maxZ.toFixed(2),
    settings.placement.spacingM,
    settings.placement.slopeMinY,
    settings.placement.minHeightM,
    settings.placement.maxHeightM,
    settings.placement.minGroundWeight,
    settings.placement.minTreeInfluence,
  ].join(":");
}

function reject(reason: VegetationTerrainRejectionReason, footprint: PageFootprint, settings: UnderstorySettings): VegetationTerrainRejectionDecision {
  return {
    reject: true,
    reason,
    skippedCandidateEstimate: estimateUnderstoryPatchCandidateCount(footprint, settings),
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

function classSpacingRadius(cls: UnderstoryClass, spacing: number): number {
  if (cls === "dead_log" || cls === "stump") return spacing * 1.7;
  if (cls === "flower" || cls === "fern") return spacing * 0.55;
  return spacing * 0.9;
}

function incrementClassStats(stats: UnderstoryGenerationStats, cls: UnderstoryClass): void {
  if (cls === "shrub") stats.acceptedShrub++;
  else if (cls === "fern") stats.acceptedFern++;
  else if (cls === "sapling") stats.acceptedSapling++;
  else if (cls === "flower") stats.acceptedFlower++;
  else if (cls === "dead_log") stats.acceptedDeadLog++;
  else stats.acceptedStump++;
}

function defaultClassBias(): UnderstoryTerrainClassWeights {
  return { density: 1, shrub: 1, fern: 1, sapling: 1, flower: 1, dead_log: 1, stump: 1 };
}

function blendTerrainBias(
  entries: readonly (readonly [UnderstoryTerrainClassWeights, number])[],
): UnderstoryTerrainClassWeights {
  const out = defaultClassBias();
  let sum = 0;
  out.density = 0;
  out.shrub = 0;
  out.fern = 0;
  out.sapling = 0;
  out.flower = 0;
  out.dead_log = 0;
  out.stump = 0;
  for (const [entry, rawWeight] of entries) {
    const weight = Math.max(0, rawWeight);
    sum += weight;
    out.density += entry.density * weight;
    out.shrub += entry.shrub * weight;
    out.fern += entry.fern * weight;
    out.sapling += entry.sapling * weight;
    out.flower += entry.flower * weight;
    out.dead_log += entry.dead_log * weight;
    out.stump += entry.stump * weight;
  }
  if (sum <= 0) return defaultClassBias();
  const inv = 1 / sum;
  out.density *= inv;
  out.shrub *= inv;
  out.fern *= inv;
  out.sapling *= inv;
  out.flower *= inv;
  out.dead_log *= inv;
  out.stump *= inv;
  return out;
}
