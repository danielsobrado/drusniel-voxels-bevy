import { describe, expect, it } from "vitest";
import type { GrassStats } from "../grass.js";
import type { UnderstoryStats } from "../understory/index.js";
import { aggregateGpuVegetationEarlyRejectCounters } from "./gpu_vegetation_early_reject_counters.js";

function grassStats(overrides: Partial<GrassStats> = {}): GrassStats {
  return {
    mode: "cheap",
    blades: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    nearPatches: 0,
    midPatches: 0,
    coveragePatches: 0,
    superPatches: 0,
    generatedCandidates: 90,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
    earlyTerrainReasonCounts: {},
    patchRebuildCount: 0,
    buildMs: 0,
    midBladeCount: 0,
    gpuRingStatus: "ready",
    gpuRingCandidateCount: 80,
    gpuRingCandidateCountBeforePrefilter: 120,
    gpuRingCandidateCountAfterPrefilter: 80,
    gpuRingPrefilterTestedClusters: 8,
    gpuRingPrefilterRejectedClusters: 3,
    gpuRingPrefilterAcceptedClusters: 5,
    gpuRingPrefilterUnknownKeptClusters: 1,
    gpuRingVisibleNear: 0,
    gpuRingVisibleMid: 0,
    gpuRingVisibleFar: 0,
    gpuRingVisibleSuper: 0,
    gpuRingDispatchMs: null,
    gpuRingReadbackMs: null,
    ...overrides,
  };
}

function understoryStats(overrides: Partial<UnderstoryStats> = {}): UnderstoryStats {
  return {
    totalInstances: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    shrub: 0,
    fern: 0,
    sapling: 0,
    flower: 0,
    deadLog: 0,
    stump: 0,
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
    earlyTerrainReasonCounts: {},
    gpuStatus: "ring",
    gpuCandidateCount: 70,
    gpuCandidateCountBeforePrefilter: 100,
    gpuCandidateCountAfterPrefilter: 70,
    gpuPrefilterTestedClusters: 6,
    gpuPrefilterRejectedClusters: 2,
    gpuPrefilterAcceptedClusters: 4,
    gpuPrefilterUnknownKeptClusters: 1,
    gpuAcceptedCount: 0,
    gpuVisibleCount: 0,
    gpuOverflowed: false,
    gpuDispatchMs: null,
    ...overrides,
  };
}

describe("aggregateGpuVegetationEarlyRejectCounters", () => {
  it("uses exact grass and understory GPU prefilter cluster counters", () => {
    const counters = aggregateGpuVegetationEarlyRejectCounters({
      grassStats: grassStats(),
      understoryStats: understoryStats(),
    });

    expect(counters.grassGpuClustersTotal).toBe(8);
    expect(counters.grassGpuClustersRejectedEarly).toBe(3);
    expect(counters.grassGpuClustersAccepted).toBe(5);
    expect(counters.understoryGpuClustersTotal).toBe(6);
    expect(counters.understoryGpuClustersRejectedEarly).toBe(2);
    expect(counters.understoryGpuClustersAccepted).toBe(4);
    expect(counters.vegetationGpuClustersTotal).toBe(14);
    expect(counters.vegetationGpuClustersRejectedEarly).toBe(5);
    expect(counters.vegetationGpuClustersAccepted).toBe(9);
  });

  it("does not count near-forced visible clusters as too-far rejections", () => {
    const counters = aggregateGpuVegetationEarlyRejectCounters({
      grassStats: grassStats({ earlyTerrainReasonCounts: { near_forced_visible: 7 } }),
      understoryStats: understoryStats({ earlyTerrainReasonCounts: { near_forced_visible: 5 } }),
    });

    expect(counters.vegetationGpuRejectTooFar).toBe(0);
  });
});
