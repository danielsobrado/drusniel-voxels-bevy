import { getDigEditRevision } from "../terrain/terrain.js";
import type { PageFootprint } from "../types.js";
import {
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG,
  type VegetationTerrainRejectionDecision,
  type VegetationTerrainRejectionReason,
} from "../vegetation/terrain_rejection_config.js";
import { VegetationTerrainRejectionCache } from "../vegetation/terrain_rejection_cache.js";
import type { UnderstorySettings } from "./understory_config.js";
import {
  understoryTerrainBias,
  type UnderstoryGenerationStats,
  type UnderstoryTerrainSampler,
} from "./understory_instances.js";

interface FootprintProbe {
  x: number;
  z: number;
}

const UNDERSTORY_PATCH_TERRAIN_REJECTION_CACHE = new VegetationTerrainRejectionCache();

export function rejectUnderstoryPatchBeforeGeneration(
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
    const cached = UNDERSTORY_PATCH_TERRAIN_REJECTION_CACHE.get(key);
    if (cached) return cached;
  }
  const decision = evaluateUnderstoryPatchBeforeGeneration(footprint, settings, sampler, worldCells);
  if (DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheEnabled) {
    UNDERSTORY_PATCH_TERRAIN_REJECTION_CACHE.set(key, decision);
  }
  return decision;
}

export function recordUnderstoryEarlyRejection(
  stats: UnderstoryGenerationStats,
  decision: VegetationTerrainRejectionDecision,
): void {
  stats.earlyTerrainRejectedPatches = (stats.earlyTerrainRejectedPatches ?? 0) + 1;
  stats.earlyTerrainSkippedCandidates = (stats.earlyTerrainSkippedCandidates ?? 0) + Math.max(0, Math.floor(decision.skippedCandidateEstimate));
  stats.earlyTerrainReasonCounts ??= {};
  stats.earlyTerrainReasonCounts[decision.reason] = (stats.earlyTerrainReasonCounts[decision.reason] ?? 0) + 1;
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
    if (reason === "unknown_kept") return accept("unknown_kept");
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
