import type { TreeLod } from "./tree_config.js";
import type { TreeGenerationStats } from "./tree_instances.js";
import type { TreeHeroFidelityStats } from "./tree_hero_fidelity.js";
import { createEmptyTreeHeroFidelityStats } from "./tree_hero_fidelity.js";
import type { TreeEarlyTerrainRejectionStats } from "./tree_patch_terrain_rejection.js";
import { visibleTreeLodCount } from "./tree_system_math.js";

export type TreeSystemGpuStatus = "disabled" | "unsupported" | "ring" | "fallback-cpu" | "error";
export type TreeSystemImpostorStatus = "disabled" | "pending" | "baking" | "baked" | "fallback";

export interface TreeVisibleClusterMaskStats {
  visibleClusterHidden: number;
  visibleClusterVisible: number;
  visibleClusterUnknownKept: number;
  gpuPrefilterTestedClusters: number;
  gpuPrefilterRejectedClusters: number;
  gpuPrefilterAcceptedClusters: number;
  gpuPrefilterUnknownKeptClusters: number;
  gpuPrefilterSkippedCandidateEstimate: number;
  gpuCandidateCountBeforePrefilter: number;
  gpuCandidateCountAfterPrefilter: number;
  gpuPrefilterCacheHits: number;
  gpuPrefilterCacheMisses: number;
  gpuPrefilterSourceFarSummary: number;
  gpuPrefilterSourceTerrainSampler: number;
  gpuPrefilterSourceFallback: number;
}

export interface TreeSystemStatsSnapshot extends TreeGenerationStats {
  totalTrees: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  terrainOccludedPatches: number;
  earlyTerrainTestedPatches: number;
  earlyTerrainRejectedPatches: number;
  earlyTerrainAcceptedPatches: number;
  earlyTerrainUnknownKeptPatches: number;
  earlyTerrainSkippedCandidates: number;
  earlyTerrainCacheHits: number;
  earlyTerrainCacheMisses: number;
  earlyTerrainHiddenPatches: number;
  earlyTerrainWaterPatches: number;
  earlyTerrainBiomePatches: number;
  earlyTerrainSteepPatches: number;
  earlyTerrainHeightPatches: number;
  earlyTerrainOutsidePatches: number;
  nearTrees: number;
  midTrees: number;
  farTrees: number;
  impostorTrees: number;
  heroNearTreeTriangles: number;
  heroNearFoliageTriangles: number;
  heroNearMinTreeTriangles: number;
  heroNearAvgTreeTriangles: number;
  heroNearPassesTriangleFloor: boolean;
  heroNearPassesRealFoliage: boolean;
  gpuStatus: TreeSystemGpuStatus;
  gpuCandidateCount: number;
  gpuCandidateCountBeforePrefilter: number;
  gpuCandidateCountAfterPrefilter: number;
  gpuPrefilterTestedClusters: number;
  gpuPrefilterRejectedClusters: number;
  gpuPrefilterAcceptedClusters: number;
  gpuPrefilterUnknownKeptClusters: number;
  gpuPrefilterSkippedCandidateEstimate: number;
  gpuPrefilterCacheHits: number;
  gpuPrefilterCacheMisses: number;
  gpuPrefilterSourceFarSummary: number;
  gpuPrefilterSourceTerrainSampler: number;
  gpuPrefilterSourceFallback: number;
  gpuAcceptedCount: number;
  gpuVisibleCount: number;
  gpuShadowCasterCount: number;
  gpuOverflowed: boolean;
  gpuShadowOverflowed: boolean;
  gpuDispatchMs: number | null;
  gpuShowCounts: boolean;
  terrainHiddenCandidates: number;
  terrainVisibleCandidates: number;
  visibleClusterHidden: number;
  visibleClusterVisible: number;
  visibleClusterUnknownKept: number;
  impostorStatus: TreeSystemImpostorStatus;
  impostorReason: string | null;
}

export interface TreeSystemStatsPatchInput {
  visible: boolean;
  terrainOccluded?: boolean;
  instances: readonly unknown[];
  generationStats: TreeGenerationStats;
}

export interface TreeSystemGpuStatsInput {
  candidateCount: number;
  candidateCountBeforePrefilter?: number;
  candidateCountAfterPrefilter?: number;
  acceptedCandidates: number;
  counts: Record<TreeLod, number>;
  shadowGroupCounts?: readonly number[];
  shadowOverflowed?: boolean;
  terrainVisibilityCounts?: {
    terrainHiddenCandidates: number;
    terrainVisibleCandidates: number;
  } | null;
  visibleClusterMaskStats?: TreeVisibleClusterMaskStats | null;
}

export interface BuildTreeSystemStatsInput {
  patches: readonly TreeSystemStatsPatchInput[];
  lodCounts: Record<TreeLod, number>;
  heroFidelity: TreeHeroFidelityStats;
  gpuRing: boolean;
  gpuRingStats: TreeSystemGpuStatsInput;
  gpuVisibleCount: number;
  gpuStatus: TreeSystemGpuStatus;
  gpuOverflowed: boolean;
  gpuDispatchMs: number | null;
  gpuShowCounts: boolean;
  impostorStatus: TreeSystemImpostorStatus;
  impostorReason: string | null;
  earlyTerrainRejectionStats?: TreeEarlyTerrainRejectionStats;
}

export function createEmptyTreeSystemStats(): TreeSystemStatsSnapshot {
  return {
    totalTrees: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    terrainOccludedPatches: 0,
    earlyTerrainTestedPatches: 0,
    earlyTerrainRejectedPatches: 0,
    earlyTerrainAcceptedPatches: 0,
    earlyTerrainUnknownKeptPatches: 0,
    earlyTerrainSkippedCandidates: 0,
    earlyTerrainCacheHits: 0,
    earlyTerrainCacheMisses: 0,
    earlyTerrainHiddenPatches: 0,
    earlyTerrainWaterPatches: 0,
    earlyTerrainBiomePatches: 0,
    earlyTerrainSteepPatches: 0,
    earlyTerrainHeightPatches: 0,
    earlyTerrainOutsidePatches: 0,
    nearTrees: 0,
    midTrees: 0,
    farTrees: 0,
    impostorTrees: 0,
    heroNearTreeTriangles: 0,
    heroNearFoliageTriangles: 0,
    heroNearMinTreeTriangles: 0,
    heroNearAvgTreeTriangles: 0,
    heroNearPassesTriangleFloor: false,
    heroNearPassesRealFoliage: false,
    gpuStatus: "disabled",
    gpuCandidateCount: 0,
    gpuCandidateCountBeforePrefilter: 0,
    gpuCandidateCountAfterPrefilter: 0,
    gpuPrefilterTestedClusters: 0,
    gpuPrefilterRejectedClusters: 0,
    gpuPrefilterAcceptedClusters: 0,
    gpuPrefilterUnknownKeptClusters: 0,
    gpuPrefilterSkippedCandidateEstimate: 0,
    gpuPrefilterCacheHits: 0,
    gpuPrefilterCacheMisses: 0,
    gpuPrefilterSourceFarSummary: 0,
    gpuPrefilterSourceTerrainSampler: 0,
    gpuPrefilterSourceFallback: 0,
    gpuAcceptedCount: 0,
    gpuVisibleCount: 0,
    gpuShadowCasterCount: 0,
    gpuOverflowed: false,
    gpuShadowOverflowed: false,
    gpuDispatchMs: null,
    gpuShowCounts: true,
    terrainHiddenCandidates: 0,
    terrainVisibleCandidates: 0,
    visibleClusterHidden: 0,
    visibleClusterVisible: 0,
    visibleClusterUnknownKept: 0,
    impostorStatus: "disabled",
    impostorReason: null,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    rejectedSlope: 0,
    rejectedHeight: 0,
    rejectedMaterial: 0,
    debugSamples: [],
  };
}

export function buildTreeSystemStats(input: BuildTreeSystemStatsInput): TreeSystemStatsSnapshot {
  const stats = createEmptyTreeSystemStats();
  const beforePrefilter = input.gpuRingStats.candidateCountBeforePrefilter ?? input.gpuRingStats.candidateCount;
  const afterPrefilter = input.gpuRingStats.candidateCountAfterPrefilter ?? input.gpuRingStats.candidateCount;
  if (input.gpuRing) {
    const visible = input.gpuVisibleCount || visibleTreeLodCount(input.gpuRingStats.counts);
    const accepted = input.gpuRingStats.acceptedCandidates || visible;
    stats.totalTrees = visible;
    stats.generatedCandidates = afterPrefilter;
    stats.acceptedCandidates = accepted;
  } else {
    for (const patch of input.patches) {
      stats.totalTrees += patch.instances.length;
      stats.patches++;
      if (patch.terrainOccluded) stats.terrainOccludedPatches++;
      if (patch.visible) stats.visiblePatches++;
      else stats.culledPatches++;
      stats.generatedCandidates += patch.generationStats.generatedCandidates;
      stats.acceptedCandidates += patch.generationStats.acceptedCandidates;
      stats.rejectedSlope += patch.generationStats.rejectedSlope;
      stats.rejectedHeight += patch.generationStats.rejectedHeight;
      stats.rejectedMaterial += patch.generationStats.rejectedMaterial;
    }
  }

  if (!input.gpuRing && input.earlyTerrainRejectionStats) {
    const early = input.earlyTerrainRejectionStats;
    stats.earlyTerrainTestedPatches = early.testedPatches;
    stats.earlyTerrainRejectedPatches = early.rejectedPatches;
    stats.earlyTerrainAcceptedPatches = early.acceptedPatches;
    stats.earlyTerrainUnknownKeptPatches = early.unknownKeptPatches;
    stats.earlyTerrainSkippedCandidates = early.skippedCandidateEstimate;
    stats.earlyTerrainCacheHits = early.cacheHits;
    stats.earlyTerrainCacheMisses = early.cacheMisses;
    stats.earlyTerrainHiddenPatches = early.reasonCounts.terrain_hidden ?? 0;
    stats.earlyTerrainWaterPatches = early.reasonCounts.below_water ?? 0;
    stats.earlyTerrainBiomePatches = early.reasonCounts.wrong_biome ?? 0;
    stats.earlyTerrainSteepPatches = early.reasonCounts.too_steep ?? 0;
    stats.earlyTerrainHeightPatches = early.reasonCounts.height_range ?? 0;
    stats.earlyTerrainOutsidePatches = early.reasonCounts.outside_world ?? 0;
  }

  stats.nearTrees = input.lodCounts.near;
  stats.midTrees = input.lodCounts.mid;
  stats.farTrees = input.lodCounts.far;
  stats.impostorTrees = input.lodCounts.impostor;
  const heroFidelity = input.heroFidelity ?? createEmptyTreeHeroFidelityStats();
  stats.heroNearTreeTriangles = heroFidelity.nearTriangleCount;
  stats.heroNearFoliageTriangles = heroFidelity.nearFoliageTriangleCount;
  stats.heroNearMinTreeTriangles = heroFidelity.minNearTreeTriangles;
  stats.heroNearAvgTreeTriangles = heroFidelity.avgNearTreeTriangles;
  stats.heroNearPassesTriangleFloor = heroFidelity.passesTriangleFloor;
  stats.heroNearPassesRealFoliage = heroFidelity.passesRealFoliage;
  stats.gpuStatus = input.gpuStatus;
  stats.gpuCandidateCount = input.gpuRing ? afterPrefilter : 0;
  stats.gpuCandidateCountBeforePrefilter = input.gpuRing ? beforePrefilter : 0;
  stats.gpuCandidateCountAfterPrefilter = input.gpuRing ? afterPrefilter : 0;
  stats.gpuAcceptedCount = input.gpuRing
    ? (input.gpuRingStats.acceptedCandidates || visibleTreeLodCount(input.gpuRingStats.counts))
    : 0;
  stats.gpuVisibleCount = input.gpuRing
    ? (input.gpuVisibleCount || visibleTreeLodCount(input.gpuRingStats.counts))
    : 0;
  stats.gpuShadowCasterCount = input.gpuRing
    ? sumCounts(input.gpuRingStats.shadowGroupCounts ?? [])
    : 0;
  stats.gpuOverflowed = input.gpuOverflowed;
  stats.gpuShadowOverflowed = input.gpuRing ? !!input.gpuRingStats.shadowOverflowed : false;
  stats.gpuDispatchMs = input.gpuDispatchMs;
  stats.gpuShowCounts = input.gpuShowCounts;
  if (input.gpuRingStats.terrainVisibilityCounts) {
    stats.terrainHiddenCandidates = input.gpuRingStats.terrainVisibilityCounts.terrainHiddenCandidates;
    stats.terrainVisibleCandidates = input.gpuRingStats.terrainVisibilityCounts.terrainVisibleCandidates;
  }
  if (input.gpuRingStats.visibleClusterMaskStats) {
    const mask = input.gpuRingStats.visibleClusterMaskStats;
    stats.visibleClusterHidden = mask.visibleClusterHidden;
    stats.visibleClusterVisible = mask.visibleClusterVisible;
    stats.visibleClusterUnknownKept = mask.visibleClusterUnknownKept;
    stats.gpuPrefilterTestedClusters = mask.gpuPrefilterTestedClusters;
    stats.gpuPrefilterRejectedClusters = mask.gpuPrefilterRejectedClusters;
    stats.gpuPrefilterAcceptedClusters = mask.gpuPrefilterAcceptedClusters;
    stats.gpuPrefilterUnknownKeptClusters = mask.gpuPrefilterUnknownKeptClusters;
    stats.gpuPrefilterSkippedCandidateEstimate = mask.gpuPrefilterSkippedCandidateEstimate;
    stats.gpuCandidateCountBeforePrefilter = mask.gpuCandidateCountBeforePrefilter;
    stats.gpuCandidateCountAfterPrefilter = mask.gpuCandidateCountAfterPrefilter;
    stats.gpuPrefilterCacheHits = mask.gpuPrefilterCacheHits;
    stats.gpuPrefilterCacheMisses = mask.gpuPrefilterCacheMisses;
    stats.gpuPrefilterSourceFarSummary = mask.gpuPrefilterSourceFarSummary;
    stats.gpuPrefilterSourceTerrainSampler = mask.gpuPrefilterSourceTerrainSampler;
    stats.gpuPrefilterSourceFallback = mask.gpuPrefilterSourceFallback;
  }
  stats.impostorStatus = input.impostorStatus;
  stats.impostorReason = input.impostorReason;
  return stats;
}

function sumCounts(counts: readonly number[]): number {
  return counts.reduce((sum, count) => sum + Math.max(0, Math.floor(count)), 0);
}
