import type * as THREE from "three";
import type { ClodPageNode, PageFootprint } from "../types.js";
import { getDigEditRevision } from "../terrain/terrain.js";
import {
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG,
  type VegetationTerrainRejectionDecision,
  type VegetationTerrainRejectionReason,
} from "../vegetation/terrain_rejection_config.js";
import { VegetationTerrainRejectionCache, quantizeTerrainRejectionBucket } from "../vegetation/terrain_rejection_cache.js";
import {
  sampleTerrainVisibility,
  type TerrainHeightSampler,
} from "../vegetation/vegetation_visibility_provider.js";
import type { TreeSettings } from "./tree_config.js";
import type { TreeTerrainSampler } from "./tree_instances.js";
import { treeFootprintCenterX, treeFootprintCenterZ, treeFootprintRadius } from "./tree_system_math.js";

export type TreeEarlyTerrainRejectionReason = VegetationTerrainRejectionReason | "not_tested";

export interface TreeEarlyTerrainRejectionStats {
  testedPatches: number;
  rejectedPatches: number;
  acceptedPatches: number;
  unknownKeptPatches: number;
  skippedCandidateEstimate: number;
  cacheHits: number;
  cacheMisses: number;
  reasonCounts: Record<TreeEarlyTerrainRejectionReason, number>;
}

export interface TreeEarlyTerrainRejectionDecision extends VegetationTerrainRejectionDecision {
  reason: TreeEarlyTerrainRejectionReason;
}

export interface TreeEarlyTerrainRejectionInput {
  node: ClodPageNode;
  settings: TreeSettings;
  sampler: TreeTerrainSampler | undefined;
  cameraPosition: THREE.Vector3;
  worldCells: number;
}

interface FootprintProbe {
  x: number;
  z: number;
}

const TREE_EARLY_TERRAIN_REJECTION_CACHE = new VegetationTerrainRejectionCache();

export function createEmptyTreeEarlyTerrainRejectionStats(): TreeEarlyTerrainRejectionStats {
  return {
    testedPatches: 0,
    rejectedPatches: 0,
    acceptedPatches: 0,
    unknownKeptPatches: 0,
    skippedCandidateEstimate: 0,
    cacheHits: 0,
    cacheMisses: 0,
    reasonCounts: createReasonCounts(),
  };
}

export function resetTreeEarlyTerrainRejectionStats(stats: TreeEarlyTerrainRejectionStats): void {
  stats.testedPatches = 0;
  stats.rejectedPatches = 0;
  stats.acceptedPatches = 0;
  stats.unknownKeptPatches = 0;
  stats.skippedCandidateEstimate = 0;
  for (const reason of Object.keys(stats.reasonCounts) as TreeEarlyTerrainRejectionReason[]) {
    stats.reasonCounts[reason] = 0;
  }
}

export function rejectTreePatchBeforeGeneration(input: TreeEarlyTerrainRejectionInput): TreeEarlyTerrainRejectionDecision {
  const cacheKey = treeRejectionCacheKey(input);
  if (DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheEnabled) {
    const cached = TREE_EARLY_TERRAIN_REJECTION_CACHE.get(cacheKey) as TreeEarlyTerrainRejectionDecision | null;
    if (cached) return cached;
  }

  const decision = evaluateTreePatchBeforeGeneration(input);
  if (DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.decisionCacheEnabled) {
    TREE_EARLY_TERRAIN_REJECTION_CACHE.set(cacheKey, decision);
  }
  return decision;
}

export function recordTreeEarlyTerrainRejection(
  stats: TreeEarlyTerrainRejectionStats | undefined,
  decision: TreeEarlyTerrainRejectionDecision,
): void {
  if (!stats) return;
  const before = TREE_EARLY_TERRAIN_REJECTION_CACHE.stats();
  stats.cacheHits = before.hits;
  stats.cacheMisses = before.misses;
  stats.testedPatches++;
  stats.reasonCounts[decision.reason]++;
  if (decision.reason === "unknown_kept" || decision.reason === "missing_sampler") stats.unknownKeptPatches++;
  if (decision.reject) {
    stats.rejectedPatches++;
    stats.skippedCandidateEstimate += Math.max(0, Math.floor(decision.skippedCandidateEstimate));
  } else {
    stats.acceptedPatches++;
  }
}

export function estimateTreePatchCandidateCount(footprint: PageFootprint, settings: TreeSettings): number {
  const spacing = Math.max(0.5, settings.placement.spacingM);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  return columns * rows;
}

function evaluateTreePatchBeforeGeneration(input: TreeEarlyTerrainRejectionInput): TreeEarlyTerrainRejectionDecision {
  if (!DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.enabled || !input.settings.enabled) return accept("disabled");
  const terrainSampler = createTerrainHeightSampler(input.sampler);
  if (!terrainSampler || !input.sampler) return accept("missing_sampler");
  const probes = footprintProbes(input.node.footprint, input.cameraPosition);
  const staticDecision = DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled
    ? evaluateStaticTreeRules(input, probes)
    : null;
  if (staticDecision?.reject) return staticDecision;

  const visibility = input.settings.gpu.terrainVisibility;
  if (!DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.viewRulesEnabled || !visibility.enabled) return accept("disabled");

  let hiddenProbeCount = 0;
  for (const probe of probes) {
    if (!probeInsideWorld(probe, input.worldCells)) return accept("unknown_kept");
    const targetSample = terrainSampler.sampleHeight(probe.x, probe.z);
    if (targetSample.unknown || !Number.isFinite(targetSample.height)) return accept("unknown_kept");

    const result = sampleTerrainVisibility({
      sampler: terrainSampler,
      settings: {
        enabled: true,
        minDistanceM: visibility.minDistanceM,
        sampleCount: visibility.sampleCount,
        heightMarginM: visibility.heightMarginM,
        crownHeightM: visibility.crownHeightM,
      },
      cameraX: input.cameraPosition.x,
      cameraY: input.cameraPosition.y,
      cameraZ: input.cameraPosition.z,
      targetX: probe.x,
      targetZ: probe.z,
      targetGroundY: targetSample.height,
      targetRadiusM: treeFootprintRadius(input.node.footprint),
    });

    if (result.visible) return accept(result.reason as TreeEarlyTerrainRejectionReason);
    hiddenProbeCount++;
  }

  if (hiddenProbeCount !== probes.length) return accept("accepted");
  return reject("terrain_hidden", input.node.footprint, input.settings);
}

function evaluateStaticTreeRules(
  input: TreeEarlyTerrainRejectionInput,
  probes: readonly FootprintProbe[],
): TreeEarlyTerrainRejectionDecision | null {
  const rejectingReasons: TreeEarlyTerrainRejectionReason[] = [];
  for (const probe of probes) {
    const reason = staticTreeRejectReason(input, probe);
    if (!reason) return null;
    if (reason === "unknown_kept") return null;
    rejectingReasons.push(reason);
  }
  return rejectingReasons.length === probes.length
    ? reject(rejectingReasons[0] ?? "wrong_biome", input.node.footprint, input.settings)
    : null;
}

function staticTreeRejectReason(input: TreeEarlyTerrainRejectionInput, probe: FootprintProbe): TreeEarlyTerrainRejectionReason | null {
  if (!probeInsideWorld(probe, input.worldCells)) return "outside_world";
  const sampler = input.sampler;
  if (!sampler) return "missing_sampler";
  const height = sampler.surfaceHeight(probe.x, probe.z);
  if (!Number.isFinite(height)) return "unknown_kept";
  const normalY = sampler.surfaceNormal(probe.x, probe.z)[1];
  if (!Number.isFinite(normalY)) return "unknown_kept";
  if (normalY < input.settings.placement.slopeMinY) return "too_steep";
  if (height < input.settings.placement.minHeightM || height > input.settings.placement.maxHeightM) return "height_range";
  const weights = sampler.materialWeights(height, normalY);
  const groundWeight = weights[0] + weights[1] * 0.25;
  if (groundWeight < input.settings.placement.minGroundWeight) return "wrong_biome";
  return null;
}

function reject(reason: TreeEarlyTerrainRejectionReason, footprint: PageFootprint, settings: TreeSettings): TreeEarlyTerrainRejectionDecision {
  return {
    reject: true,
    reason,
    skippedCandidateEstimate: estimateTreePatchCandidateCount(footprint, settings),
  };
}

function accept(reason: TreeEarlyTerrainRejectionReason): TreeEarlyTerrainRejectionDecision {
  return { reject: false, reason, skippedCandidateEstimate: 0 };
}

function createTerrainHeightSampler(sampler: TreeTerrainSampler | undefined): TerrainHeightSampler | undefined {
  if (!sampler) return undefined;
  return {
    sampleHeight: (x, z) => {
      const height = sampler.surfaceHeight(x, z);
      return { height, unknown: !Number.isFinite(height) };
    },
  };
}

function treeRejectionCacheKey(input: TreeEarlyTerrainRejectionInput): string {
  const cfg = DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG;
  const visibility = input.settings.gpu.terrainVisibility;
  return [
    "tree",
    input.node.id,
    getDigEditRevision(),
    quantizeTerrainRejectionBucket(input.cameraPosition.x, cfg.cameraBucketM),
    quantizeTerrainRejectionBucket(input.cameraPosition.z, cfg.cameraBucketM),
    input.settings.placement.spacingM,
    input.settings.placement.slopeMinY,
    input.settings.placement.minHeightM,
    input.settings.placement.maxHeightM,
    input.settings.placement.minGroundWeight,
    visibility.enabled ? 1 : 0,
    visibility.minDistanceM,
    visibility.sampleCount,
    visibility.heightMarginM,
    visibility.crownHeightM,
  ].join(":");
}

function footprintProbes(footprint: PageFootprint, cameraPosition: THREE.Vector3): FootprintProbe[] {
  const center = { x: treeFootprintCenterX(footprint), z: treeFootprintCenterZ(footprint) };
  const corners: FootprintProbe[] = [
    { x: footprint.minX, z: footprint.minZ },
    { x: footprint.minX, z: footprint.maxZ },
    { x: footprint.maxX, z: footprint.minZ },
    { x: footprint.maxX, z: footprint.maxZ },
  ];
  corners.sort((a, b) => distanceSq(a, cameraPosition) - distanceSq(b, cameraPosition));
  return dedupeProbes([corners[0] ?? center, center, ...corners]);
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

function distanceSq(probe: FootprintProbe, cameraPosition: THREE.Vector3): number {
  const dx = probe.x - cameraPosition.x;
  const dz = probe.z - cameraPosition.z;
  return dx * dx + dz * dz;
}

function probeInsideWorld(probe: FootprintProbe, worldCells: number): boolean {
  return probe.x >= 0 && probe.z >= 0 && probe.x <= worldCells && probe.z <= worldCells;
}

function createReasonCounts(): Record<TreeEarlyTerrainRejectionReason, number> {
  return {
    accepted: 0,
    visible: 0,
    terrain_hidden: 0,
    unknown_kept: 0,
    near_forced_visible: 0,
    disabled: 0,
    missing_sampler: 0,
    below_water: 0,
    wrong_biome: 0,
    too_steep: 0,
    height_range: 0,
    outside_world: 0,
    not_tested: 0,
  } as Record<TreeEarlyTerrainRejectionReason, number>;
}
