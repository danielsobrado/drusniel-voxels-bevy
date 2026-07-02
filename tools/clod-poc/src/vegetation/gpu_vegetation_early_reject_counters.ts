import type { GrassStats } from "../grass.js";
import type { TreeStats } from "../trees/index.js";
import type { UnderstoryStats } from "../understory/index.js";

export interface GpuVegetationEarlyRejectCounters {
  vegetationGpuClustersTotal: number;
  vegetationGpuClustersRejectedEarly: number;
  vegetationGpuClustersAccepted: number;
  vegetationGpuClustersSummaryMissing: number;
  vegetationGpuCandidatesBudgetBeforeReject: number;
  vegetationGpuCandidatesBudgetAfterReject: number;
  vegetationGpuCandidatesGenerated: number;
  vegetationGpuRejectOutsideTerrain: number;
  vegetationGpuRejectTerrainHidden: number;
  vegetationGpuRejectNoCoverage: number;
  vegetationGpuRejectInvalidSurface: number;
  vegetationGpuEarlyRejectMs: number;
}

export function emptyGpuVegetationEarlyRejectCounters(): GpuVegetationEarlyRejectCounters {
  return {
    vegetationGpuClustersTotal: 0,
    vegetationGpuClustersRejectedEarly: 0,
    vegetationGpuClustersAccepted: 0,
    vegetationGpuClustersSummaryMissing: 0,
    vegetationGpuCandidatesBudgetBeforeReject: 0,
    vegetationGpuCandidatesBudgetAfterReject: 0,
    vegetationGpuCandidatesGenerated: 0,
    vegetationGpuRejectOutsideTerrain: 0,
    vegetationGpuRejectTerrainHidden: 0,
    vegetationGpuRejectNoCoverage: 0,
    vegetationGpuRejectInvalidSurface: 0,
    vegetationGpuEarlyRejectMs: 0,
  };
}

export function aggregateGpuVegetationEarlyRejectCounters(input: {
  treeStats?: TreeStats | null;
  grassStats?: GrassStats | null;
  understoryStats?: UnderstoryStats | null;
}): GpuVegetationEarlyRejectCounters {
  const counters = emptyGpuVegetationEarlyRejectCounters();

  const tree = input.treeStats;
  if (tree) {
    counters.vegetationGpuClustersTotal += tree.gpuPrefilterTestedClusters ?? 0;
    counters.vegetationGpuClustersRejectedEarly += tree.gpuPrefilterRejectedClusters ?? 0;
    counters.vegetationGpuClustersAccepted += tree.gpuPrefilterAcceptedClusters ?? 0;
    counters.vegetationGpuClustersSummaryMissing += tree.gpuPrefilterUnknownKeptClusters ?? 0;
    counters.vegetationGpuCandidatesBudgetBeforeReject += tree.gpuCandidateCountBeforePrefilter ?? tree.gpuCandidateCount ?? 0;
    counters.vegetationGpuCandidatesBudgetAfterReject += tree.gpuCandidateCountAfterPrefilter ?? tree.gpuCandidateCount ?? 0;
    counters.vegetationGpuCandidatesGenerated += tree.gpuCandidateCount ?? 0;
    counters.vegetationGpuRejectTerrainHidden += tree.gpuPrefilterRejectedClusters ?? 0;
  }

  const grass = input.grassStats;
  if (grass) {
    counters.vegetationGpuCandidatesBudgetBeforeReject += grass.gpuRingCandidateCountBeforePrefilter ?? grass.gpuRingCandidateCount ?? 0;
    counters.vegetationGpuCandidatesBudgetAfterReject += grass.gpuRingCandidateCountAfterPrefilter ?? grass.gpuRingCandidateCount ?? 0;
    counters.vegetationGpuCandidatesGenerated += grass.generatedCandidates ?? 0;
    counters.vegetationGpuClustersRejectedEarly += Math.max(0, (grass.gpuRingCandidateCountBeforePrefilter ?? 0) - (grass.gpuRingCandidateCountAfterPrefilter ?? 0));
    counters.vegetationGpuRejectTerrainHidden += Math.max(0, (grass.gpuRingCandidateCountBeforePrefilter ?? 0) - (grass.gpuRingCandidateCountAfterPrefilter ?? 0));
  }

  const understory = input.understoryStats;
  if (understory) {
    counters.vegetationGpuCandidatesBudgetBeforeReject += understory.gpuCandidateCountBeforePrefilter ?? understory.gpuCandidateCount ?? 0;
    counters.vegetationGpuCandidatesBudgetAfterReject += understory.gpuCandidateCountAfterPrefilter ?? understory.gpuCandidateCount ?? 0;
    counters.vegetationGpuCandidatesGenerated += understory.gpuCandidateCount ?? 0;
    counters.vegetationGpuClustersRejectedEarly += Math.max(0, (understory.gpuCandidateCountBeforePrefilter ?? 0) - (understory.gpuCandidateCountAfterPrefilter ?? 0));
    counters.vegetationGpuRejectTerrainHidden += Math.max(0, (understory.gpuCandidateCountBeforePrefilter ?? 0) - (understory.gpuCandidateCountAfterPrefilter ?? 0));
  }

  return counters;
}
