import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG } from "./terrain_rejection_config.js";
import { buildVegetationSlotPrefilter, VegetationSlotPrefilterCache } from "./vegetation_slot_prefilter.js";
import type { TerrainHeightSampler, TerrainVisibilitySettings } from "./vegetation_visibility_provider.js";

beforeEach(() => {
  DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG.enabled = true;
});
afterEach(() => {
  DEFAULT_VEGETATION_GPU_EARLY_REJECT_CONFIG.enabled = false;
});

const VISIBILITY: TerrainVisibilitySettings = {
  enabled: true,
  minDistanceM: 0,
  sampleCount: 4,
  heightMarginM: 0,
  crownHeightM: 0,
};

function sampler(height: number): TerrainHeightSampler {
  return { sampleHeight: () => ({ height, unknown: !Number.isFinite(height) }) };
}

describe("shared vegetation slot prefilter", () => {
  it("keeps every slot when terrain visibility is disabled", () => {
    const result = buildVegetationSlotPrefilter({
      kind: "test",
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      grid: 5,
      cell: 4,
      clusterDimSlots: 2,
      visibility: { ...VISIBILITY, enabled: false },
      sampler: sampler(100),
    });

    expect(result.rejectedClusters).toBe(0);
    expect(result.candidateSlotsBeforePrefilter).toBe(25);
    expect(result.candidateSlotsAfterPrefilter).toBe(25);
    expect(new Set(Array.from(result.activeSlotIndices)).size).toBe(25);
  });

  it("keeps every slot when clusters are below the minimum early-reject size", () => {
    const result = buildVegetationSlotPrefilter({
      kind: "grass",
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      grid: 8,
      cell: 1,
      clusterDimSlots: 4,
      visibility: VISIBILITY,
      sampler: sampler(100),
    });

    expect(result.rejectedClusters).toBe(0);
    expect(result.candidateSlotsBeforePrefilter).toBe(64);
    expect(result.candidateSlotsAfterPrefilter).toBe(64);
    expect(Array.from(result.activeSlotIndices)).toEqual([...Array(64).keys()]);
  });

  it("rejects hidden clusters before slot dispatch", () => {
    const result = buildVegetationSlotPrefilter({
      kind: "test",
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      grid: 16,
      cell: 4,
      clusterDimSlots: 4,
      visibility: VISIBILITY,
      sampler: sampler(100),
    });

    expect(result.rejectedClusters).toBeGreaterThan(0);
    expect(result.candidateSlotsAfterPrefilter).toBeLessThan(result.candidateSlotsBeforePrefilter);
    expect(result.activeSlotIndices.length).toBe(result.candidateSlotsAfterPrefilter);
    expect(result.skippedCandidateEstimate).toBe(result.candidateSlotsBeforePrefilter - result.candidateSlotsAfterPrefilter);
  });

  it("keeps unknown clusters visible", () => {
    const result = buildVegetationSlotPrefilter({
      kind: "test",
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      grid: 16,
      cell: 4,
      clusterDimSlots: 4,
      visibility: VISIBILITY,
      sampler: sampler(Number.NaN),
    });

    expect(result.rejectedClusters).toBe(0);
    expect(result.unknownKeptClusters).toBeGreaterThan(0);
    expect(result.candidateSlotsAfterPrefilter).toBe(result.candidateSlotsBeforePrefilter);
  });

  it("caches decisions by camera bucket and terrain revision", () => {
    const cache = new VegetationSlotPrefilterCache();
    const first = buildVegetationSlotPrefilter({
      kind: "test",
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      grid: 16,
      cell: 4,
      clusterDimSlots: 4,
      visibility: VISIBILITY,
      sampler: sampler(100),
      terrainRevision: 1,
      cache,
    });
    const second = buildVegetationSlotPrefilter({
      kind: "test",
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      grid: 16,
      cell: 4,
      clusterDimSlots: 4,
      visibility: VISIBILITY,
      sampler: sampler(100),
      terrainRevision: 1,
      cache,
    });

    expect(first.cacheHits).toBe(0);
    expect(first.cacheMisses).toBeGreaterThan(0);
    expect(second.cacheHits).toBe(first.cacheMisses);
    expect(second.cacheMisses).toBe(0);
    expect(second.activeSlotIndices).toEqual(first.activeSlotIndices);
  });

  it("misses again when provider revision changes", () => {
    const cache = new VegetationSlotPrefilterCache();
    const base = {
      kind: "test",
      centerX: 64,
      centerZ: 64,
      cameraY: 0,
      worldCells: 512,
      grid: 16,
      cell: 4,
      clusterDimSlots: 4,
      visibility: VISIBILITY,
      sampler: sampler(100),
      terrainRevision: 1,
      cache,
    };
    const first = buildVegetationSlotPrefilter({ ...base, providerRevision: 1 });
    const second = buildVegetationSlotPrefilter({ ...base, providerRevision: 2 });

    expect(first.cacheMisses).toBeGreaterThan(0);
    expect(second.cacheHits).toBe(0);
    expect(second.cacheMisses).toBe(first.cacheMisses);
  });
});
