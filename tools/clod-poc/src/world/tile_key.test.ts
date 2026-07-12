import { describe, expect, it } from "vitest";
import { regionKeyForWorld } from "../save/region_key.js";
import {
  parseStreamingClodPageKey,
  streamingClodPageKey,
} from "../terrain/streaming/clod_streaming_roots.js";
import {
  CLOD_PAGES_PER_WORLD_TILE_AXIS,
  WORLD_TILE_SIZE_M,
  clodPagesForTile,
  tileKeyString,
  tileOriginM,
  toHydrologyTileCoord,
  toSaveRegionKey,
  worldToTile,
} from "./tile_key.js";

describe("world tile keys", () => {
  it("uses hydrology-compatible floor division for negative coordinates", () => {
    for (const [x, z] of [
      [0, 0],
      [255.999, 255.999],
      [256, 256],
      [-0.001, -0.001],
      [-256, -256],
      [-256.001, 511.5],
    ] as const) {
      const key = worldToTile(x, z);
      expect(key).toEqual({
        x: Math.floor(x / WORLD_TILE_SIZE_M),
        z: Math.floor(z / WORLD_TILE_SIZE_M),
      });
      expect(toHydrologyTileCoord(key)).toEqual({ tileX: key.x, tileZ: key.z });
    }
  });

  it("matches the existing 512 m save-region mapping", () => {
    for (let tileZ = -5; tileZ <= 5; tileZ++) {
      for (let tileX = -5; tileX <= 5; tileX++) {
        const key = { x: tileX, z: tileZ };
        const origin = tileOriginM(key);
        expect(toSaveRegionKey(key)).toBe(regionKeyForWorld(origin.x, origin.z));
        expect(tileKeyString(key)).toBe(`T:${tileX},${tileZ}`);
      }
    }
  });

  it("maps one 256 m tile to the existing 4x4 L0 CLOD page grid", () => {
    for (const key of [{ x: 0, z: 0 }, { x: -2, z: 3 }]) {
      const pages = clodPagesForTile(key);
      expect(pages).toHaveLength(CLOD_PAGES_PER_WORLD_TILE_AXIS ** 2);
      for (const page of pages) {
        expect(parseStreamingClodPageKey(streamingClodPageKey(page.px, page.pz, page.level))).toEqual(page);
        expect(Math.floor(page.px / CLOD_PAGES_PER_WORLD_TILE_AXIS)).toBe(key.x);
        expect(Math.floor(page.pz / CLOD_PAGES_PER_WORLD_TILE_AXIS)).toBe(key.z);
      }
    }
  });

  it("rejects non-finite world coordinates and non-integer keys", () => {
    expect(() => worldToTile(Number.NaN, 0)).toThrow("world x must be finite");
    expect(() => tileOriginM({ x: 0.5, z: 0 })).toThrow("safe integers");
  });
});
