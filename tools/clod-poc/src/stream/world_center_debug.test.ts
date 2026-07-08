import { describe, expect, it } from "vitest";
import {
  WORLD_CENTER_DEBUG_SOURCE_CODE,
  centerDistance,
  centerWithinThreshold,
  computeWorldCenterDebugStats,
  publishWorldCenterStatsToCounters,
} from "./world_center_debug.js";

describe("world center debug", () => {
  it("computes camera-to-center distances in X/Z", () => {
    const stats = computeWorldCenterDebugStats({
      camera: { x: 10, z: 20 },
      vegetationRingCenter: { x: 13, z: 24 },
      vegetationGrassCenter: { x: 10, z: 20 },
      vegetationTreesCenter: { x: 10, z: 12 },
      canopyCenter: { x: 16, z: 28 },
      waterOceanCenter: { x: 7, z: 16 },
    });
    expect(stats.cameraToVegetationRingCenterM).toBe(5);
    expect(stats.cameraToVegetationGrassCenterM).toBe(0);
    expect(stats.cameraToVegetationTreesCenterM).toBe(8);
    expect(stats.cameraToCanopyCenterM).toBe(10);
    expect(stats.cameraToWaterOceanCenterM).toBe(5);
  });

  it("rejects non-finite centers", () => {
    expect(() => centerDistance({ x: 0, z: 0 }, { x: Number.NaN, z: 0 })).toThrow(/finite/);
    expect(() => computeWorldCenterDebugStats({ camera: { x: 0, z: 0 }, canopyCenter: { x: 1, z: Infinity } })).toThrow(/finite/);
  });

  it("keeps source code mapping stable", () => {
    expect(WORLD_CENTER_DEBUG_SOURCE_CODE).toEqual({
      camera: 1,
      vegetationRing: 2,
      vegetationGrass: 3,
      vegetationTrees: 4,
      canopy: 5,
      waterOcean: 6,
    });
  });

  it("does not crash or publish missing optional centers", () => {
    const stats = computeWorldCenterDebugStats({ camera: { x: 0, z: 0 } });
    const counters: Record<string, number> = {};
    publishWorldCenterStatsToCounters(counters, stats);
    expect(counters).toEqual({});
  });

  it("publishes camelCase stats as snake_case counters", () => {
    const counters: Record<string, number> = {};
    publishWorldCenterStatsToCounters(counters, {
      cameraToVegetationRingCenterM: 1,
      cameraToVegetationGrassCenterM: 2,
      cameraToVegetationTreesCenterM: 3,
      cameraToCanopyCenterM: 4,
      cameraToWaterOceanCenterM: 5,
    });
    expect(counters).toEqual({
      camera_to_vegetation_ring_center_m: 1,
      camera_to_vegetation_grass_center_m: 2,
      camera_to_vegetation_trees_center_m: 3,
      camera_to_canopy_center_m: 4,
      camera_to_water_ocean_center_m: 5,
    });
  });

  it("supports threshold checks", () => {
    expect(centerWithinThreshold(undefined, 8)).toBe(true);
    expect(centerWithinThreshold(8, 8)).toBe(true);
    expect(centerWithinThreshold(8.01, 8)).toBe(false);
  });
});
