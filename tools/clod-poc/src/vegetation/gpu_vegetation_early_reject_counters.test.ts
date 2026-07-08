import { describe, expect, it } from "vitest";
import type { GrassStats } from "../grass.js";
import type { StoneStats } from "../stones/stone_instances.js";
import type { UnderstoryStats } from "../understory/index.js";
import { aggregateGpuVegetationEarlyRejectCounters } from "./gpu_vegetation_early_reject_counters.js";

function grassStats(overrides: Partial<GrassStats> = {}): GrassStats {
  return {
    mode: "webgpu-ring-v1",
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
    gpuRingPrefilterFarSummaryConsulted: 4,
    gpuRingPrefilterSourceFarSummary: 2,
    gpuRingPrefilterSourceTerrainSampler: 3,
    gpuRingPrefilterSourceFallback: 4,
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
    gpuPrefilterFarSummaryConsulted: 8,
    gpuPrefilterSourceFarSummary: 5,
    gpuPrefilterSourceTerrainSampler: 6,
    gpuPrefilterSourceFallback: 7,
    gpuAcceptedCount: 0,
    gpuVisibleCount: 0,
    gpuOverflowed: false,
    gpuDispatchMs: null,
    ...overrides,
  };
}

function stoneStats(overrides: Partial<StoneStats> = {}): StoneStats {
  return {
    total: 9,
    large: 1,
    medium: 3,
    small: 5,
    visible: 9,
    drawnNear: 9,
    drawnFar: 0,
    groups: 3,
    gpuCandidateCount: 64,
    gpuCandidateCountBeforePrefilter: 64,
    gpuCandidateCountAfterPrefilter: 12,
    gpuPrefilterTestedClusters: 64,
    gpuPrefilterRejectedClusters: 52,
    gpuPrefilterAcceptedClusters: 12,
    gpuPrefilterUnknownKeptClusters: 0,
    gpuPrefilterFarSummaryConsulted: 0,
    gpuPrefilterSourceFarSummary: 0,
    gpuPrefilterSourceTerrainSampler: 64,
    gpuPrefilterSourceFallback: 0,
    earlyTerrainReasonCounts: {
      outside_world: 2,
      too_far: 3,
      below_water: 5,
      too_steep: 7,
      density_mask: 31,
      tile_budget: 4,
      class_budget: 0,
      terrain_hidden: 52,
    },
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

  it("aggregates consulted and source counters across vegetation systems", () => {
    const counters = aggregateGpuVegetationEarlyRejectCounters({
      grassStats: grassStats(),
      understoryStats: understoryStats(),
    });

    expect(counters.vegetationGpuFarSummaryConsulted).toBe(12);
    expect(counters.grassGpuPrefilterFarSummaryConsulted).toBe(4);
    expect(counters.understoryGpuPrefilterFarSummaryConsulted).toBe(8);
    expect(counters.vegetationGpuSourceFarSummary).toBe(7);
    expect(counters.vegetationGpuSourceTerrainSampler).toBe(9);
    expect(counters.vegetationGpuSourceFallback).toBe(11);
  });

  it("includes stone GPU early rejection counters in the existing namespace", () => {
    const counters = aggregateGpuVegetationEarlyRejectCounters({
      stoneStats: stoneStats(),
    });

    expect(counters.stoneGpuClustersTotal).toBe(64);
    expect(counters.stoneGpuClustersRejectedEarly).toBe(52);
    expect(counters.stoneGpuClustersAccepted).toBe(12);
    expect(counters.stoneGpuSourceTerrainSampler).toBe(64);
    expect(counters["stoneReject.below_water"]).toBe(5);
    expect(counters["stoneReject.too_steep"]).toBe(7);
    expect(counters["stoneReject.outside_world"]).toBe(2);
    expect(counters["stoneReject.too_far"]).toBe(3);
    expect(counters["stoneReject.density_mask"]).toBe(31);
    expect(counters["stoneReject.tile_budget"]).toBe(4);
    expect(counters["stoneReject.terrain_hidden"]).toBe(52);
    expect(counters.vegetationGpuClustersTotal).toBe(64);
    expect(counters.vegetationGpuRejectBelowWater).toBe(5);
    expect(counters.vegetationGpuRejectInvalidSurface).toBe(7);
    expect(counters.vegetationGpuRejectNoCoverage).toBe(31);
    expect(counters.vegetationGpuRejectTooFar).toBe(3);
  });

  it("aggregates stones with grass and understory", () => {
    const counters = aggregateGpuVegetationEarlyRejectCounters({
      grassStats: grassStats(),
      understoryStats: understoryStats(),
      stoneStats: stoneStats(),
    });

    expect(counters.vegetationGpuClustersTotal).toBe(78);
    expect(counters.vegetationGpuClustersRejectedEarly).toBe(57);
    expect(counters.vegetationGpuClustersAccepted).toBe(21);
    expect(counters.vegetationGpuSourceTerrainSampler).toBe(73);
  });

  it("does not count near-forced visible clusters as too-far rejections", () => {
    const counters = aggregateGpuVegetationEarlyRejectCounters({
      grassStats: grassStats({ earlyTerrainReasonCounts: { near_forced_visible: 7 } }),
      understoryStats: understoryStats({ earlyTerrainReasonCounts: { near_forced_visible: 5 } }),
    });

    expect(counters.vegetationGpuRejectTooFar).toBe(0);
  });
});
