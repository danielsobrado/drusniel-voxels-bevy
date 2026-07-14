import { describe, expect, it } from "vitest";
import {
  buildCaveTestVoxelOverlay,
  CAVE_TEST_ENTRANCE_X,
  CAVE_TEST_ENTRANCE_Z,
} from "../../terrain/voxel_overlay/voxel_overlay.js";
import { buildHeightfieldTile } from "./heightfield_tile.js";
import { WORLD_TILE_SIZE_M } from "../tile_key.js";
import {
  buildHeightfieldTileComplexity,
  HEIGHTFIELD_COMPLEXITY_CELL_COUNT,
} from "./heightfield_tile_complexity.js";

describe("heightfield tile complexity", () => {
  it("uses the allocation-free null fast path for ordinary tiles", () => {
    const complexity = buildHeightfieldTileComplexity({ x: 20, z: 20 }, null);
    const tile = buildHeightfieldTile({ x: 20, z: 20 }, { sampleHeight: () => 4, complexity });

    expect(tile.complexVolumeMask).toBeNull();
    expect(tile.entranceMask).toBeNull();
    expect(tile.voxelRegionRefs).toEqual([]);
  });

  it("writes sparse complex and entrance masks with region references", () => {
    const source = buildCaveTestVoxelOverlay(() => 10);
    const complexity = buildHeightfieldTileComplexity({
      x: Math.floor(CAVE_TEST_ENTRANCE_X / WORLD_TILE_SIZE_M),
      z: Math.floor(CAVE_TEST_ENTRANCE_Z / WORLD_TILE_SIZE_M),
    }, source);

    expect(complexity.complexVolumeMask).toHaveLength(HEIGHTFIELD_COMPLEXITY_CELL_COUNT);
    expect(complexity.entranceMask).toHaveLength(HEIGHTFIELD_COMPLEXITY_CELL_COUNT);
    expect(complexity.complexVolumeMask?.some(Boolean)).toBe(true);
    expect(complexity.entranceMask?.some(Boolean)).toBe(true);
    expect(complexity.voxelRegionRefs).toEqual(["cave-test-system"]);
  });
});
