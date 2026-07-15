import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectPropEditStore } from "../../project/prop_edit_store.js";
import { savedPropStore } from "../../save/prop_store.js";
import { setVoxelOverlaySource } from "../../terrain/voxel_overlay/voxel_overlay.js";
import { HEIGHTFIELD_TILE_RES } from "../../world/heightfield_tiles/heightfield_tile.js";
import {
  VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M,
  maskVegetationAuthorityHeightfieldTile,
  refreshVegetationAuthorityHeightfieldMask,
  vegetationAuthorityHeightfieldMaskStats,
} from "./heightfield_mask.js";

const TILE_SAMPLE_COUNT = HEIGHTFIELD_TILE_RES * HEIGHTFIELD_TILE_RES;

function sampleIndex(x: number, z: number): number {
  return z * HEIGHTFIELD_TILE_RES + x;
}

beforeEach(() => {
  projectPropEditStore.clear();
  savedPropStore.clear();
  setVoxelOverlaySource(null);
  refreshVegetationAuthorityHeightfieldMask();
});

afterEach(() => {
  projectPropEditStore.clear();
  savedPropStore.clear();
  setVoxelOverlaySource(null);
  refreshVegetationAuthorityHeightfieldMask();
});

describe("vegetation authority heightfield mask", () => {
  it("masks project-prop footprints without changing the canonical source array", () => {
    projectPropEditStore.add({
      id: "authority-prop",
      prefabId: "unknown-prop",
      position: [8, 0, 8],
      scale: [1, 1, 1],
    });
    expect(refreshVegetationAuthorityHeightfieldMask()).toBe(true);

    const heights = new Float32Array(TILE_SAMPLE_COUNT);
    heights.fill(42);
    const masked = maskVegetationAuthorityHeightfieldTile({ x: 0, z: 0 }, heights);

    expect(masked).not.toBe(heights);
    expect(masked[sampleIndex(8, 8)]).toBe(VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M);
    expect(masked[sampleIndex(64, 64)]).toBe(42);
    expect(heights[sampleIndex(8, 8)]).toBe(42);
    expect(vegetationAuthorityHeightfieldMaskStats().projectPropFootprints).toBe(1);
  });

  it("tracks destroyed environmental props independently of active project props", () => {
    savedPropStore.upsert({
      id: "destroyed-environmental-prop",
      prefabId: "unknown-prop",
      position: [12, 0, 12],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      regionKey: "r_0_0",
      state: "destroyed",
      tags: ["environmental"],
      environmental: { tileKey: { x: 0, z: 0 }, layer: "tree", candidateIndex: 7 },
    });
    expect(refreshVegetationAuthorityHeightfieldMask()).toBe(true);

    const heights = new Float32Array(TILE_SAMPLE_COUNT);
    const masked = maskVegetationAuthorityHeightfieldTile({ x: 0, z: 0 }, heights);

    expect(masked[sampleIndex(12, 12)]).toBe(VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M);
    expect(vegetationAuthorityHeightfieldMaskStats().destroyedPropFootprints).toBe(1);
  });

  it("masks procedural cave entrances and tunnel footprints", () => {
    setVoxelOverlaySource({
      regions: [{
        id: "cave",
        bounds: { minX: 16, minY: -20, minZ: 16, maxX: 80, maxY: 30, maxZ: 80 },
        caveSystem: {
          id: "cave-system",
          entranceIds: ["entrance"],
          proceduralSeed: 19,
          authored: false,
          criticalPathIds: [],
          revision: 1,
        },
        caveEntrances: [{
          id: "entrance",
          position: [24, 10, 24],
          facing: [1, 0, 0],
          caveSystemId: "cave-system",
          farMaskRadiusM: 6,
          revision: 1,
        }],
        stamps: [],
      }],
    });
    expect(refreshVegetationAuthorityHeightfieldMask()).toBe(true);

    const heights = new Float32Array(TILE_SAMPLE_COUNT);
    heights.fill(21);
    const masked = maskVegetationAuthorityHeightfieldTile({ x: 0, z: 0 }, heights);

    expect(masked[sampleIndex(24, 24)]).toBe(VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M);
    expect(masked[sampleIndex(44, 24)]).toBe(VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M);
    expect(vegetationAuthorityHeightfieldMaskStats().voxelFootprints).toBeGreaterThanOrEqual(3);
  });

  it("returns the original array when a tile has no exclusions", () => {
    const heights = new Float32Array(TILE_SAMPLE_COUNT);
    expect(maskVegetationAuthorityHeightfieldTile({ x: 3, z: 3 }, heights)).toBe(heights);
  });
});
