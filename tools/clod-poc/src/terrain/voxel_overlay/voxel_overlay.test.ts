import { afterEach, describe, expect, it } from "vitest";
import {
  density,
  replaceVoxelEdits,
  setTerrainSurfaceOverride,
  setVoxelOverlaySource,
} from "../terrain.js";
import {
  buildCaveTestVoxelOverlay,
  CAVE_TEST_ENTRANCE_X,
  CAVE_TEST_ENTRANCE_Z,
  composeVoxelOverlayDensity,
  isCaveEntranceBoundary,
  sampleCaveEntranceCoverage,
  type VoxelOverlaySource,
} from "./voxel_overlay.js";

function overlayWithFill(): VoxelOverlaySource {
  const source = buildCaveTestVoxelOverlay(() => 10);
  return {
    regions: source.regions.map((region) => ({
      ...region,
      stamps: [{
        id: "authored-fill",
        hash: "fill-v1",
        operation: "fill",
        shape: "sphere",
        start: [CAVE_TEST_ENTRANCE_X, 8, CAVE_TEST_ENTRANCE_Z],
        radiusM: 5,
      }],
    })),
  };
}

afterEach(() => {
  setVoxelOverlaySource(null);
  setTerrainSurfaceOverride(null);
  replaceVoxelEdits({ revision: 0, deltas: [] });
});

describe("voxel overlay density composition", () => {
  it("generates deterministic entrance tubes and chambers from SavedCaveSystem seeds", () => {
    const source = buildCaveTestVoxelOverlay(() => 10);
    const first = composeVoxelOverlayDensity(2, CAVE_TEST_ENTRANCE_X, 8, CAVE_TEST_ENTRANCE_Z, source);
    const second = composeVoxelOverlayDensity(2, CAVE_TEST_ENTRANCE_X, 8, CAVE_TEST_ENTRANCE_Z, source);

    expect(first).toBeLessThan(0);
    expect(second).toBe(first);
  });

  it("applies caves, authored stamps, then player deltas", () => {
    setTerrainSurfaceOverride(() => 10);
    setVoxelOverlaySource(overlayWithFill());
    expect(density(CAVE_TEST_ENTRANCE_X, 8, CAVE_TEST_ENTRANCE_Z)).toBeGreaterThan(0);

    replaceVoxelEdits({ revision: 7, deltas: [{ x: CAVE_TEST_ENTRANCE_X, y: 8, z: CAVE_TEST_ENTRANCE_Z, density: -9, revision: 7 }] });
    expect(density(CAVE_TEST_ENTRANCE_X, 8, CAVE_TEST_ENTRANCE_Z)).toBe(-9);
  });

  it("leaves ordinary density bit-identical when no overlay is installed", () => {
    setTerrainSurfaceOverride((x, z) => Math.fround(x * 0.25 + z * 0.5));
    const expected = Math.fround(3 * 0.25 + 5 * 0.5) - 7;
    expect(density(3, 7, 5)).toBe(expected);
  });

  it("does not compose cave density outside the complex region bounds", () => {
    const source = buildCaveTestVoxelOverlay(() => 10);
    expect(composeVoxelOverlayDensity(2, CAVE_TEST_ENTRANCE_X, 100, CAVE_TEST_ENTRANCE_Z, source)).toBe(2);
  });

  it("publishes only cave entrances into the far summary", () => {
    const source = buildCaveTestVoxelOverlay(() => 10);
    expect(sampleCaveEntranceCoverage(704, 80, 32, source)).toBeGreaterThan(0);
    expect(sampleCaveEntranceCoverage(1024, 1024, 32, source)).toBe(0);
    expect(isCaveEntranceBoundary(CAVE_TEST_ENTRANCE_X, CAVE_TEST_ENTRANCE_Z, source)).toBe(true);
    expect(isCaveEntranceBoundary(CAVE_TEST_ENTRANCE_X, CAVE_TEST_ENTRANCE_Z + 48, source)).toBe(false);
  });
});
