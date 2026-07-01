import type { TreeLod } from "./tree_config.js";
import type { TreeGenerationStats } from "./tree_instances.js";
import type { TreeHeroFidelityStats } from "./tree_hero_fidelity.js";
import { createEmptyTreeHeroFidelityStats } from "./tree_hero_fidelity.js";
import { visibleTreeLodCount } from "./tree_system_math.js";

export type TreeSystemGpuStatus = "disabled" | "unsupported" | "ring" | "fallback-cpu" | "error";
export type TreeSystemImpostorStatus = "disabled" | "pending" | "baking" | "baked" | "fallback";

export interface TreeSystemStatsSnapshot extends TreeGenerationStats {
  totalTrees: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  terrainOccludedPatches: number;
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
  gpuAcceptedCount: number;
  gpuVisibleCount: number;
  gpuShadowCasterCount: number;
  gpuOverflowed: boolean;
  gpuShadowOverflowed: boolean;
  gpuDispatchMs: number | null;
  gpuShowCounts: boolean;
  terrainHiddenCandidates: number;
  terrainVisibleCandidates: number;
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
  acceptedCandidates: number;
  counts: Record<TreeLod, number>;
  shadowGroupCounts?: readonly number[];
  shadowOverflowed?: boolean;
  terrainVisibilityCounts?: {
    terrainHiddenCandidates: number;
    terrainVisibleCandidates: number;
  } | null;
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
}

export function createEmptyTreeSystemStats(): TreeSystemStatsSnapshot {
  return {
    totalTrees: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    terrainOccludedPatches: 0,
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
    gpuAcceptedCount: 0,
    gpuVisibleCount: 0,
    gpuShadowCasterCount: 0,
    gpuOverflowed: false,
    gpuShadowOverflowed: false,
    gpuDispatchMs: null,
    gpuShowCounts: true,
    terrainHiddenCandidates: 0,
    terrainVisibleCandidates: 0,
    impostorStatus: "disabled",
    impostorReason: null,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    rejectedSlope: 0,
    rejectedHeight: 0,
    rejectedMaterial: 0,
  };
}

export function buildTreeSystemStats(input: BuildTreeSystemStatsInput): TreeSystemStatsSnapshot {
  const stats = createEmptyTreeSystemStats();
  if (input.gpuRing) {
    const visible = input.gpuVisibleCount || visibleTreeLodCount(input.gpuRingStats.counts);
    const accepted = input.gpuRingStats.acceptedCandidates || visible;
    stats.totalTrees = visible;
    stats.generatedCandidates = input.gpuRingStats.candidateCount;
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
  stats.gpuCandidateCount = input.gpuRing ? input.gpuRingStats.candidateCount : 0;
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
  stats.impostorStatus = input.impostorStatus;
  stats.impostorReason = input.impostorReason;
  return stats;
}

function sumCounts(counts: readonly number[]): number {
  return counts.reduce((sum, count) => sum + Math.max(0, Math.floor(count)), 0);
}
