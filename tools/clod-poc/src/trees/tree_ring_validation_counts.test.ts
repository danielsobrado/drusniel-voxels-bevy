import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS, cloneTreeSettings } from "./tree_config.js";
import { generateTreeRingValidationCounts } from "./tree_ring_validation_counts.js";
import type { TreeTerrainSampler } from "./tree_instances.js";

describe("tree ring validation counts", () => {
  it("validates against an empty prefiltered slot list without sampling terrain", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.distanceM = 24;

    const counts = generateTreeRingValidationCounts({
      centerX: 64,
      centerZ: 64,
      cameraY: 10,
      worldCells: 512,
      settings,
      sampler: throwingTerrain(),
      maxInstancesPerGroup: 100,
      maxShadowCastersPerGroup: 100,
      activeSlotIndices: new Uint32Array(0),
    });

    expect(counts.counts).toEqual({ near: 0, mid: 0, far: 0, impostor: 0 });
    expect(counts.groupCounts.every((count) => count === 0)).toBe(true);
    expect(counts.shadowGroupCounts.every((count) => count === 0)).toBe(true);
    expect(counts.overflowed).toBe(false);
    expect(counts.shadowOverflowed).toBe(false);
  });

  it("samples only the supplied active slots", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    settings.distanceM = 24;
    settings.placement.minHeightM = -1000;
    settings.placement.maxHeightM = 1000;
    const sampler = countingTerrain(0);

    generateTreeRingValidationCounts({
      centerX: 64,
      centerZ: 64,
      cameraY: 10,
      worldCells: 512,
      settings,
      sampler,
      maxInstancesPerGroup: 100,
      maxShadowCastersPerGroup: 100,
      activeSlotIndices: new Uint32Array([0, 1, 2]),
    });

    expect(sampler.heightSamples).toBeLessThanOrEqual(3);
  });
});

function throwingTerrain(): TreeTerrainSampler {
  return {
    surfaceHeight: () => { throw new Error("terrain should not be sampled for an empty active slot list"); },
    surfaceNormal: () => [0, 1, 0],
    materialWeights: () => [1, 0, 0, 0],
  };
}

function countingTerrain(height: number): TreeTerrainSampler & { heightSamples: number } {
  return {
    heightSamples: 0,
    surfaceHeight() { this.heightSamples++; return height; },
    surfaceNormal: () => [0, 1, 0],
    materialWeights: () => [1, 0, 0, 0],
  };
}
