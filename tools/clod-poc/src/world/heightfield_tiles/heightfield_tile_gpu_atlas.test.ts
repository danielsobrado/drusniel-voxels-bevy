import { describe, expect, it } from "vitest";
import { terrainFieldShaderWithTileAtlas } from "../../terrain/streaming/gpu_clod_root_mesher.js";
import { HEIGHTFIELD_TILE_RES } from "./heightfield_tile.js";
import { heightfieldTileAtlasTexel } from "./heightfield_tile_gpu_atlas.js";
import { buildHeightfieldTile } from "./heightfield_tile.js";
import { worldToTile } from "../tile_key.js";

describe("heightfield tile GPU atlas", () => {
  it("maps positive and negative world tiles into deterministic toroidal slots", () => {
    expect(heightfieldTileAtlasTexel({ x: 0, z: 0 }, 0, 0, 7)).toEqual({ x: 0, z: 0 });
    expect(heightfieldTileAtlasTexel({ x: 7, z: 7 }, 12, 34, 7)).toEqual({ x: 12, z: 34 });
    expect(heightfieldTileAtlasTexel({ x: -1, z: -2 }, 0, 0, 7)).toEqual({
      x: 6 * HEIGHTFIELD_TILE_RES,
      z: 5 * HEIGHTFIELD_TILE_RES,
    });
  });

  it("replaces procedural surface reads with exact unfiltered textureLoad lattice reads", () => {
    const shader = terrainFieldShaderWithTileAtlas();
    expect(shader).toContain("fn proceduralSurfaceHeightField");
    expect(shader).toContain("fn surfaceHeightField");
    expect(shader).toContain("textureLoad(continentHeightAtlas");
    expect(shader).not.toContain("textureSample(continentHeightAtlas");
    expect(shader).toContain("@binding(10)");
    expect(shader).toContain("@binding(11)");
  });

  it("quantizes tile-atlas normal probes before finite differences so welded f32 seam vertices agree", () => {
    const shader = terrainFieldShaderWithTileAtlas();
    expect(shader).toContain("fn continentStableNormalCoordinate");
    expect(shader).toContain("densityGradient(continentStableNormalCoordinate(p.x)");
  });

  it("mirrors exact f32 lattice reads across positive and negative tile borders", () => {
    const side = 7;
    const atlasRes = side * HEIGHTFIELD_TILE_RES;
    const data = new Float32Array(atlasRes * atlasRes);
    const tiles = [-1, 0, 1].map((x) => buildHeightfieldTile({ x, z: 0 }, {
      sampleHeight: (worldX, worldZ) => worldX * 0.125 + worldZ * 0.25,
    }));
    for (const tile of tiles) {
      const origin = heightfieldTileAtlasTexel(tile.key, 0, 0, side);
      for (let z = 0; z < HEIGHTFIELD_TILE_RES; z++) {
        data.set(tile.heights.subarray(z * HEIGHTFIELD_TILE_RES, (z + 1) * HEIGHTFIELD_TILE_RES),
          (origin.z + z) * atlasRes + origin.x);
      }
    }
    for (const x of [-256, -1, 0, 255, 256, 511]) {
      const key = worldToTile(x, 0);
      const localX = x - key.x * 256;
      const texel = heightfieldTileAtlasTexel(key, localX, 0, side);
      expect(data[texel.z * atlasRes + texel.x]).toBe(Math.fround(x * 0.125));
    }
  });
});
