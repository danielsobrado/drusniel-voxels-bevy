import type { GrassStats } from "../grass.js";
import type { TreeStats } from "../trees/index.js";
import type { UnderstoryStats } from "../understory/index.js";

export interface GpuVegetationEarlyRejectCounters {
  vegetationGpuClustersTotal: number;
  vegetationGpuClustersRejectedEarly: number;
  vegetationGpuClustersAccepted: number;
  vegetationGpuClustersSummaryMissing: number;
  vegetationGpuClustersRevisionMismatch: number;
  vegetationGpuClustersFallbackAccepted: number;
  vegetationGpuSourceFarSummary: number;
  vegetationGpuSourceTerrainSampler: number;
  vegetationGpuSourceFallback: number;
  vegetationGpuCandidatesBudgetBeforeReject: number;
  vegetationGpuCandidatesBudgetAfterReject: number;
  vegetationGpuCandidatesGenerated: number;
  vegetationGpuRejectOutsideTerrain: number;
  vegetationGpuRejectTerrainHidden: number;
  vegetationGpuRejectNoCoverage: number;
  vegetationGpuRejectInvalidSurface: number;
  vegetationGpuRejectTooFar: number;
  vegetationGpuRejectBelowWater: number;
  vegetationGpuEarlyRejectMs: number;
  treeGpuClustersTotal: number;
  treeGpuClustersRejectedEarly: number;
  treeGpuClustersAccepted: number;
  treeGpuRejectTerrainHidden: number;
  treeGpuRejectNoCoverage: number;
  treeGpuRejectSummaryMissing: number;
  grassGpuClustersTotal: number;
  grassGpuClustersRejectedEarly: number;
  grassGpuClustersAccepted: number;
  grassGpuRejectTerrainHidden: number;
  grassGpuRejectNoCoverage: number;
  grassGpuRejectSummaryMissing: number;
  understoryGpuClustersTotal: number;
  understoryGpuClustersRejectedEarly: number;
  understoryGpuClustersAccepted: number;
  understoryGpuRejectTerrainHidden: number;
  understoryGpuRejectNoCoverage: number;
  understoryGpuRejectSummaryMissing: number;
}

export function emptyGpuVegetationEarlyRejectCounters(): GpuVegetationEarlyRejectCounters {
  return {
    vegetationGpuClustersTotal: 0,
    vegetationGpuClustersRejectedEarly: 0,
    vegetationGpuClustersAccepted: 0,
    vegetationGpuClustersSummaryMissing: 0,
    vegetationGpuClustersRevisionMismatch: 0,
    vegetationGpuClustersFallbackAccepted: 0,
    vegetationGpuSourceFarSummary: 0,
    vegetationGpuSourceTerrainSampler: 0,
    vegetationGpuSourceFallback: 0,
    vegetationGpuCandidatesBudgetBeforeReject: 0,
    vegetationGpuCandidatesBudgetAfterReject: 0,
    vegetationGpuCandidatesGenerated: 0,
    vegetationGpuRejectOutsideTerrain: 0,
    vegetationGpuRejectTerrainHidden: 0,
    vegetationGpuRejectNoCoverage: 0,
    vegetationGpuRejectInvalidSurface: 0,
    vegetationGpuRejectTooFar: 0,
    vegetationGpuRejectBelowWater: 0,
    vegetationGpuEarlyRejectMs: 0,
    treeGpuClustersTotal: 0,
    treeGpuClustersRejectedEarly: 0,
    treeGpuClustersAccepted: 0,
    treeGpuRejectTerrainHidden: 0,
    treeGpuRejectNoCoverage: 0,
    treeGpuRejectSummaryMissing: 0,
    grassGpuClustersTotal: 0,
    grassGpuClustersRejectedEarly: 0,
    grassGpuClustersAccepted: 0,
    grassGpuRejectTerrainHidden: 0,
    grassGpuRejectNoCoverage: 0,
    grassGpuRejectSummaryMissing: 0,
    understoryGpuClustersTotal: 0,
    understoryGpuClustersRejectedEarly: 0,
    understoryGpuClustersAccepted: 0,
    understoryGpuRejectTerrainHidden: 0,
    understoryGpuRejectNoCoverage: 0,
    understoryGpuRejectSummaryMissing: 0,
  };
}

export function aggregateGpuVegetationEarlyRejectCounters(input: {
  treeStats?: TreeStats | null;
  grassStats?: GrassStats | null;
  understoryStats?: UnderstoryStats | null;
}): GpuVegetationEarlyRejectCounters {
  const counters = emptyGpuVegetationEarlyRejectCounters();

  addTreeCounters(counters, input.treeStats ?? null);
  addGrassCounters(counters, input.grassStats ?? null);
  addUnderstoryCounters(counters, input.understoryStats ?? null);

  return counters;
}

function addTreeCounters(counters: GpuVegetationEarlyRejectCounters, tree: TreeStats | null): void {
  if (!tree) return;
  const total = tree.gpuPrefilterTestedClusters ?? 0;
  const rejected = tree.gpuPrefilterRejectedClusters ?? 0;
  const accepted = tree.gpuPrefilterAcceptedClusters ?? 0;
  const missing = tree.gpuPrefilterUnknownKeptClusters ?? 0;

  counters.treeGpuClustersTotal += total;
  counters.treeGpuClustersRejectedEarly += rejected;
  counters.treeGpuClustersAccepted += accepted;
  counters.treeGpuRejectTerrainHidden += rejected;
  counters.treeGpuRejectSummaryMissing += missing;

  counters.vegetationGpuClustersTotal += total;
  counters.vegetationGpuClustersRejectedEarly += rejected;
  counters.vegetationGpuClustersAccepted += accepted;
  counters.vegetationGpuClustersSummaryMissing += missing;
  counters.vegetationGpuSourceFarSummary += tree.gpuPrefilterSourceFarSummary ?? 0;
  counters.vegetationGpuSourceTerrainSampler += tree.gpuPrefilterSourceTerrainSampler ?? 0;
  counters.vegetationGpuSourceFallback += tree.gpuPrefilterSourceFallback ?? 0;
  counters.vegetationGpuCandidatesBudgetBeforeReject += tree.gpuCandidateCountBeforePrefilter ?? tree.gpuCandidateCount ?? 0;
  counters.vegetationGpuCandidatesBudgetAfterReject += tree.gpuCandidateCountAfterPrefilter ?? tree.gpuCandidateCount ?? 0;
  counters.vegetationGpuCandidatesGenerated += tree.gpuCandidateCount ?? 0;
  counters.vegetationGpuRejectTerrainHidden += rejected;
}

function addGrassCounters(counters: GpuVegetationEarlyRejectCounters, grass: GrassStats | null): void {
  if (!grass) return;
  const before = grass.gpuRingCandidateCountBeforePrefilter ?? grass.gpuRingCandidateCount ?? 0;
  const after = grass.gpuRingCandidateCountAfterPrefilter ?? grass.gpuRingCandidateCount ?? 0;
  const total = grass.gpuRingPrefilterTestedClusters ?? estimateClusterCount(before, after);
  const rejected = grass.gpuRingPrefilterRejectedClusters ?? Math.max(0, total - (grass.gpuRingPrefilterAcceptedClusters ?? total));
  const accepted = grass.gpuRingPrefilterAcceptedClusters ?? Math.max(0, total - rejected);
  const missing = grass.gpuRingPrefilterUnknownKeptClusters ?? 0;
  const reasonCounts = grass.earlyTerrainReasonCounts ?? {};
  const noCoverage = reasonCounts.wrong_biome ?? 0;
  const terrainHidden = reasonCounts.terrain_hidden ?? rejected;

  counters.grassGpuClustersTotal += total;
  counters.grassGpuClustersRejectedEarly += rejected;
  counters.grassGpuClustersAccepted += accepted;
  counters.grassGpuRejectTerrainHidden += terrainHidden;
  counters.grassGpuRejectNoCoverage += noCoverage;
  counters.grassGpuRejectSummaryMissing += missing;

  counters.vegetationGpuClustersTotal += total;
  counters.vegetationGpuClustersRejectedEarly += rejected;
  counters.vegetationGpuClustersAccepted += accepted;
  counters.vegetationGpuClustersSummaryMissing += missing;
  counters.vegetationGpuSourceFarSummary += grass.gpuRingPrefilterSourceFarSummary ?? 0;
  counters.vegetationGpuSourceTerrainSampler += grass.gpuRingPrefilterSourceTerrainSampler ?? 0;
  counters.vegetationGpuSourceFallback += grass.gpuRingPrefilterSourceFallback ?? 0;
  counters.vegetationGpuCandidatesBudgetBeforeReject += before;
  counters.vegetationGpuCandidatesBudgetAfterReject += after;
  counters.vegetationGpuCandidatesGenerated += grass.generatedCandidates ?? 0;
  counters.vegetationGpuRejectTerrainHidden += terrainHidden;
  counters.vegetationGpuRejectNoCoverage += noCoverage;
  counters.vegetationGpuRejectBelowWater += reasonCounts.below_water ?? 0;
}

function addUnderstoryCounters(counters: GpuVegetationEarlyRejectCounters, understory: UnderstoryStats | null): void {
  if (!understory) return;
  const before = understory.gpuCandidateCountBeforePrefilter ?? understory.gpuCandidateCount ?? 0;
  const after = understory.gpuCandidateCountAfterPrefilter ?? understory.gpuCandidateCount ?? 0;
  const total = understory.gpuPrefilterTestedClusters ?? estimateClusterCount(before, after);
  const rejected = understory.gpuPrefilterRejectedClusters ?? Math.max(0, total - (understory.gpuPrefilterAcceptedClusters ?? total));
  const accepted = understory.gpuPrefilterAcceptedClusters ?? Math.max(0, total - rejected);
  const missing = understory.gpuPrefilterUnknownKeptClusters ?? 0;
  const reasonCounts = understory.earlyTerrainReasonCounts ?? {};
  const noCoverage = reasonCounts.wrong_biome ?? 0;
  const terrainHidden = reasonCounts.terrain_hidden ?? rejected;

  counters.understoryGpuClustersTotal += total;
  counters.understoryGpuClustersRejectedEarly += rejected;
  counters.understoryGpuClustersAccepted += accepted;
  counters.understoryGpuRejectTerrainHidden += terrainHidden;
  counters.understoryGpuRejectNoCoverage += noCoverage;
  counters.understoryGpuRejectSummaryMissing += missing;

  counters.vegetationGpuClustersTotal += total;
  counters.vegetationGpuClustersRejectedEarly += rejected;
  counters.vegetationGpuClustersAccepted += accepted;
  counters.vegetationGpuClustersSummaryMissing += missing;
  counters.vegetationGpuSourceFarSummary += understory.gpuPrefilterSourceFarSummary ?? 0;
  counters.vegetationGpuSourceTerrainSampler += understory.gpuPrefilterSourceTerrainSampler ?? 0;
  counters.vegetationGpuSourceFallback += understory.gpuPrefilterSourceFallback ?? 0;
  counters.vegetationGpuCandidatesBudgetBeforeReject += before;
  counters.vegetationGpuCandidatesBudgetAfterReject += after;
  counters.vegetationGpuCandidatesGenerated += understory.gpuCandidateCount ?? 0;
  counters.vegetationGpuRejectTerrainHidden += terrainHidden;
  counters.vegetationGpuRejectNoCoverage += noCoverage;
  counters.vegetationGpuRejectBelowWater += reasonCounts.below_water ?? 0;
}

function estimateClusterCount(before: number, after: number): number {
  if (before <= 0 && after <= 0) return 0;
  return Math.max(1, Math.ceil(Math.max(before, after) / (16 * 16)));
}
