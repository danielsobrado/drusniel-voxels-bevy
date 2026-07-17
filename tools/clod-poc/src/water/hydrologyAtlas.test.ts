import { describe, expect, it } from "vitest";
import {
  HYDROLOGY_ATLAS_INVALID_SHORE_DISTANCE,
  HydrologyStreamingAtlas,
  type HydrologyTileAtlasSource,
} from "./hydrologyAtlas.js";
import { HydrologyTileCache } from "./hydrologyTileSource.js";
import { sampleInfiniteHydrology } from "./infinite_hydrology.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

// Same undulating deterministic terrain as hydrologyTileSource.test.ts.
const sampler: TerrainHeightSampler = {
  surfaceHeight: (x: number, z: number) =>
    24 + Math.sin(x * 0.004) * 14 + Math.cos(z * 0.0031) * 11 + Math.sin((x + z) * 0.0012) * 6,
};

const TILE_SIZE_M = 256;
const TILE_RES = 16;
const TILES_PER_SIDE = 2;
const DRY_SENTINEL_M = 2;

function makeSource(cache: HydrologyTileCache, prewarmed: Set<string>): HydrologyTileAtlasSource {
  return {
    tileSizeM: TILE_SIZE_M,
    tileRes: TILE_RES,
    atlasTilesPerSide: TILES_PER_SIDE,
    peek: (tileX, tileZ) =>
      prewarmed.has(`${tileX},${tileZ}`) ? cache.getOrBuildTile(tileX, tileZ) : null,
    prefetch: () => {},
  };
}

function makeAtlas(): HydrologyStreamingAtlas {
  return new HydrologyStreamingAtlas({ tileSizeM: TILE_SIZE_M, tileRes: TILE_RES, tilesPerSide: TILES_PER_SIDE });
}

function makeCache(): HydrologyTileCache {
  return new HydrologyTileCache(sampler, {
    tileSizeM: TILE_SIZE_M,
    tileRes: TILE_RES,
    maxResidentTiles: 16,
    drySentinelDepthM: DRY_SENTINEL_M,
  });
}

describe("HydrologyStreamingAtlas", () => {
  it("copies resident tiles bit-identically onto the texel lattice", () => {
    const cache = makeCache();
    const resident = new Set(["2,2", "3,2", "2,3", "3,3"]);
    const atlas = makeAtlas();
    // Center inside tile (3,3) so the window origin lands at tile (2,2).
    const dirty = atlas.update(3 * TILE_SIZE_M + 10, 3 * TILE_SIZE_M + 10, makeSource(cache, resident));
    expect(dirty).toEqual([{ x: 0, z: 0, width: atlas.res, height: atlas.res }]);
    expect(atlas.originX).toBe(2 * TILE_SIZE_M);
    expect(atlas.originZ).toBe(2 * TILE_SIZE_M);

    // Every texel matches the analytic field at its world position (Layout A channels).
    for (const [ix, iz] of [[0, 0], [5, 9], [TILE_RES, TILE_RES], [atlas.res - 1, atlas.res - 1]] as const) {
      const wx = atlas.originX + ix * atlas.cellSize;
      const wz = atlas.originZ + iz * atlas.cellSize;
      const analytic = sampleInfiniteHydrology(wx, wz, sampler, { drySentinelDepthM: DRY_SENTINEL_M });
      const base = (iz * atlas.res + ix) * 4;
      expect(atlas.data[base]).toBeCloseTo(analytic.waterY, 3);
      expect(atlas.data[base + 1]).toBeCloseTo(analytic.bodyMask, 3);
      expect(atlas.data[base + 2]).toBeCloseTo(analytic.terrainY, 3);
      expect(atlas.data[base + 3]).toBeCloseTo(analytic.shoreDistance, 3);
      expect(atlas.data[base + 3]).toBeGreaterThanOrEqual(0);
    }
    expect(atlas.currentStats().filledTiles).toBe(4);
  });

  it("fills Layout B (flow + bodyKind) from the same tiles and zeroes it on invalidate", () => {
    const cache = makeCache();
    const resident = new Set(["2,2", "3,2", "2,3", "3,3"]);
    const atlas = makeAtlas();
    atlas.update(3 * TILE_SIZE_M + 10, 3 * TILE_SIZE_M + 10, makeSource(cache, resident));
    for (const [ix, iz] of [[0, 0], [5, 9], [TILE_RES, TILE_RES], [atlas.res - 1, atlas.res - 1]] as const) {
      const wx = atlas.originX + ix * atlas.cellSize;
      const wz = atlas.originZ + iz * atlas.cellSize;
      const analytic = sampleInfiniteHydrology(wx, wz, sampler, { drySentinelDepthM: DRY_SENTINEL_M });
      const base = (iz * atlas.res + ix) * 4;
      expect(atlas.dataB[base]).toBeCloseTo(analytic.flowX, 3);
      expect(atlas.dataB[base + 1]).toBeCloseTo(analytic.flowZ, 3);
      expect(atlas.dataB[base + 2]).toBeCloseTo(analytic.flowStrength, 3);
      expect(atlas.dataB[base + 3]).toBeCloseTo(analytic.bodyKind, 3);
    }
    // Recenter far away with nothing resident: both planes reset.
    atlas.update(50 * TILE_SIZE_M, 50 * TILE_SIZE_M, makeSource(cache, new Set()));
    expect(atlas.dataB.every((v) => v === 0)).toBe(true);
  });

  it("marks texels of missing tiles with the invalid shore-distance sentinel", () => {
    const cache = makeCache();
    const resident = new Set(["2,2"]); // only the north-west slot has data
    const atlas = makeAtlas();
    atlas.update(3 * TILE_SIZE_M + 10, 3 * TILE_SIZE_M + 10, makeSource(cache, resident));

    const valid = (0 * atlas.res + 0) * 4 + 3; // inside slot (0,0)
    expect(atlas.data[valid]).toBeGreaterThanOrEqual(0);
    const invalid = ((TILE_RES + 2) * atlas.res + (TILE_RES + 2)) * 4 + 3; // inside slot (1,1)
    expect(atlas.data[invalid]).toBe(HYDROLOGY_ATLAS_INVALID_SHORE_DISTANCE);
    expect(atlas.currentStats().filledTiles).toBe(1);
  });

  it("fills late-arriving tiles incrementally and reports their dirty rects", () => {
    const cache = makeCache();
    const resident = new Set<string>(["2,2"]);
    const source = makeSource(cache, resident);
    const atlas = makeAtlas();
    atlas.update(3 * TILE_SIZE_M + 10, 3 * TILE_SIZE_M + 10, source);

    // Nothing new: idle update reports no dirty rects.
    expect(atlas.update(3 * TILE_SIZE_M + 10, 3 * TILE_SIZE_M + 10, source)).toEqual([]);

    resident.add("3,3"); // worker delivered the south-east tile
    const dirty = atlas.update(3 * TILE_SIZE_M + 10, 3 * TILE_SIZE_M + 10, source);
    expect(dirty).toEqual([{ x: TILE_RES, z: TILE_RES, width: TILE_RES + 1, height: TILE_RES + 1 }]);
    const texel = ((TILE_RES + 2) * atlas.res + (TILE_RES + 2)) * 4 + 3;
    expect(atlas.data[texel]).toBeGreaterThanOrEqual(0);
    expect(atlas.currentStats().filledTiles).toBe(2);
  });

  it("recenters when the camera crosses a tile boundary and refills from the cache", () => {
    const cache = makeCache();
    const resident = new Set(["2,2", "3,2", "2,3", "3,3", "4,2", "4,3"]);
    const source = makeSource(cache, resident);
    const atlas = makeAtlas();
    atlas.update(3 * TILE_SIZE_M + 10, 3 * TILE_SIZE_M + 10, source);
    expect(atlas.originX).toBe(2 * TILE_SIZE_M);

    // Move one tile east: window becomes tiles (3..4, 2..3), all resident.
    const dirty = atlas.update(4 * TILE_SIZE_M + 10, 3 * TILE_SIZE_M + 10, source);
    expect(atlas.originX).toBe(3 * TILE_SIZE_M);
    expect(dirty).toEqual([{ x: 0, z: 0, width: atlas.res, height: atlas.res }]);
    expect(atlas.currentStats().filledTiles).toBe(4);
    expect(atlas.currentStats().recenters).toBe(2); // first anchor + the move

    // Spot-check a texel in the newly exposed east column.
    const ix = atlas.res - 1;
    const wx = atlas.originX + ix * atlas.cellSize;
    const wz = atlas.originZ + 3 * atlas.cellSize;
    const analytic = sampleInfiniteHydrology(wx, wz, sampler, { drySentinelDepthM: DRY_SENTINEL_M });
    const base = (3 * atlas.res + ix) * 4;
    expect(atlas.data[base]).toBeCloseTo(analytic.waterY, 3);
  });

  it("peekTile never builds and getOrBuildTile results are shared with the atlas", () => {
    const cache = makeCache();
    expect(cache.peekTile(7, 7)).toBeNull();
    expect(cache.stats.builds).toBe(0);
    const built = cache.getOrBuildTile(7, 7);
    expect(cache.peekTile(7, 7)).toBe(built);
    expect(cache.stats.builds).toBe(1);
  });
});
