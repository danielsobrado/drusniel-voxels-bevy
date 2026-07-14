import { afterEach, describe, expect, it } from "vitest";
import {
  buildCaveTestVoxelOverlay,
  CAVE_TEST_ENTRANCE_X,
  CAVE_TEST_ENTRANCE_Z,
  setVoxelOverlaySource,
  setVoxelOverlayResidentBounds,
} from "../terrain/voxel_overlay/voxel_overlay.js";
import { setTerrainSurfaceOverride } from "../terrain/terrain_surface.js";
import { CAVE_OCCUPANCY_MAX_STEPS, traceCaveOccupancy } from "./cave_occupancy.js";

afterEach(() => {
  setVoxelOverlaySource(null);
  setTerrainSurfaceOverride(null);
});

describe("NAADF cave occupancy", () => {
  it("skips entirely when no complex cells are resident", () => {
    setTerrainSurfaceOverride(() => 10);
    setVoxelOverlaySource(buildCaveTestVoxelOverlay(() => 10));
    expect(traceCaveOccupancy(0, 0, 0, 0, 1, 0, 100)).toBeNull();
  });

  it("uses a bounded density march for cave sun visibility", () => {
    setTerrainSurfaceOverride(() => 10);
    setVoxelOverlaySource(buildCaveTestVoxelOverlay(() => 10));
    setVoxelOverlayResidentBounds("cave-page", {
      minX: CAVE_TEST_ENTRANCE_X - 16,
      minZ: CAVE_TEST_ENTRANCE_Z - 16,
      maxX: CAVE_TEST_ENTRANCE_X + 16,
      maxZ: CAVE_TEST_ENTRANCE_Z + 32,
    });
    const trace = traceCaveOccupancy(CAVE_TEST_ENTRANCE_X, 8, CAVE_TEST_ENTRANCE_Z + 12, 0, 1, 0, 1000);

    expect(trace?.blocked).toBe(true);
    expect(trace?.steps).toBeLessThanOrEqual(CAVE_OCCUPANCY_MAX_STEPS);
  });
});
