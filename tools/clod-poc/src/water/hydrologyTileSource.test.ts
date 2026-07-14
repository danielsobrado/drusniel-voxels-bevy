import { describe, expect, it } from "vitest";
import {
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_RIVER,
} from "./hydrologyGrid.js";
import {
  buildHydrologyTileData,
  HydrologyTileCache,
  sampleTile,
  type HydrologyTile,
  type HydrologyTileRemoteSource,
} from "./hydrologyTileSource.js";
import { sampleInfiniteHydrology } from "./infinite_hydrology.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

const sampler: TerrainHeightSampler = {
  surfaceHeight: (x: number, z: number) =>
    24 + Math.sin(x * 0.004) * 14 + Math.cos(z * 0.0031) * 11 + Math.sin((x + z) * 0.0012) * 6,
};

const OPTIONS = { tileSizeM: 256, tileRes: 32, maxResidentTiles: 4, drySentinelDepthM: 2 };
const IDENTITY_TILE_RES = 1;
const IDENTITY_TILE_VERTEX_COUNT = 4;

function identityTile(): HydrologyTile {
  return {
    tileX: 0,
    tileZ: 0,
    originX: 0,
    originZ: 0,
    cellSize: 1,
    res: IDENTITY_TILE_RES,
    terrainY: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    waterY: new Float32Array(IDENTITY_TILE_VERTEX_COUNT).fill(1),
    bodyMask: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    lakeMask: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    riverMask: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    flowX: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    flowZ: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    flowStrength: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    riverDepth: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    moisture: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    shoreDistance: new Float32Array(IDENTITY_TILE_VERTEX_COUNT),
    bodyKind: new Uint8Array(IDENTITY_TILE_VERTEX_COUNT),
    bodyId: new Uint32Array(IDENTITY_TILE_VERTEX_COUNT),
  };
}

describe("HydrologyTileCache", () => {
  it("is deterministic: two caches agree exactly at arbitrary coordinates", () => {
    const a = new HydrologyTileCache(sampler, OPTIONS);
    const b = new HydrologyTileCache(sampler, OPTIONS);
    for (let i = 0; i < 50; i++) {
      const x = 1000 + i * 137.31;
      const z = -400 + i * 93.7;
      const sa = a.sample(x, z);
      const sb = b.sample(x, z);
      expect(sb.waterY).toBe(sa.waterY);
      expect(sb.depth).toBe(sa.depth);
      expect(sb.bodyMask).toBe(sa.bodyMask);
      expect(sb.bodyId).toBe(sa.bodyId);
      expect(sb.bodyKind).toBe(sa.bodyKind);
    }
  });

  it("matches the analytic field exactly at tile vertex coordinates", () => {
    const cache = new HydrologyTileCache(sampler, OPTIONS);
    const cell = OPTIONS.tileSizeM / OPTIONS.tileRes;
    for (const [vx, vz] of [
      [512, 512],
      [512 + cell * 3, 512 + cell * 7],
      [-256, 768],
    ] as const) {
      const tile = cache.sample(vx, vz);
      const analytic = sampleInfiniteHydrology(vx, vz, sampler, { drySentinelDepthM: OPTIONS.drySentinelDepthM });
      expect(tile.waterY).toBeCloseTo(analytic.waterY, 3);
      expect(tile.terrainY).toBeCloseTo(analytic.terrainY, 3);
      expect(tile.bodyKind).toBe(analytic.bodyKind);
    }
  });

  it("is continuous across a tile boundary (shared-edge vertices are identical)", () => {
    const cache = new HydrologyTileCache(sampler, OPTIONS);
    const boundaryX = OPTIONS.tileSizeM * 3;
    for (let z = 100; z < 900; z += 55.5) {
      const left = cache.sample(boundaryX - 1e-3, z);
      const right = cache.sample(boundaryX + 1e-3, z);
      expect(Math.abs(right.waterY - left.waterY)).toBeLessThan(0.05);
      expect(Math.abs(right.bodyMask - left.bodyMask)).toBeLessThan(0.05);
    }
  });

  it("reproduces identical values after LRU eviction and rebuild", () => {
    const cache = new HydrologyTileCache(sampler, { ...OPTIONS, maxResidentTiles: 1 });
    const first = cache.sample(700, 700);
    cache.sample(5000, 5000);
    expect(cache.stats.evictions).toBeGreaterThan(0);
    const again = cache.sample(700, 700);
    expect(again.waterY).toBe(first.waterY);
    expect(again.depth).toBe(first.depth);
    expect(again.bodyMask).toBe(first.bodyMask);
    expect(again.bodyId).toBe(first.bodyId);
    expect(cache.stats.builds).toBeGreaterThanOrEqual(3);
  });

  it("deduplicates: repeat samples in one tile hit the cache", () => {
    const cache = new HydrologyTileCache(sampler, OPTIONS);
    cache.sample(100, 100);
    cache.sample(110, 120);
    cache.sample(90, 80);
    expect(cache.stats.builds).toBe(1);
    expect(cache.stats.hits).toBe(2);
  });

  it("continues prefetching at a stationary center after each worker batch completes", async () => {
    const options = { ...OPTIONS, maxResidentTiles: 64 };
    const cache = new HydrologyTileCache(sampler, options);
    const remote: HydrologyTileRemoteSource = {
      available: () => true,
      build: async (tiles) => tiles.map(({ tileX, tileZ }) => buildHydrologyTileData(
        tileX,
        tileZ,
        sampler,
        options,
      )),
    };
    cache.attachRemote(remote);

    for (let pass = 0; pass < 8; pass++) {
      cache.prefetchAround(0, 0, 3 * options.tileSizeM);
      await Promise.resolve();
    }
    cache.prefetchAround(0, 0, 3 * options.tileSizeM);

    expect(cache.stats.remoteBuilds).toBe(49);
    expect(cache.stats.remoteInflight).toBe(0);
  });
});

describe("hydrology tile identity sampling", () => {
  it("uses the nearest valid wet corner when the geometric nearest corner is dry", () => {
    const input = identityTile();
    input.bodyMask[0] = 1;
    input.bodyKind[0] = HYDROLOGY_BODY_LAKE;
    input.bodyId[0] = 42;

    const sample = sampleTile(input, 0.75, 0.25);

    expect(sample.bodyMask).toBeGreaterThan(0);
    expect(sample.bodyKind).toBe(HYDROLOGY_BODY_LAKE);
    expect(sample.bodyId).toBe(42);
  });

  it("selects body kind and id from the same nearest wet corner", () => {
    const input = identityTile();
    input.bodyMask[0] = 1;
    input.bodyKind[0] = HYDROLOGY_BODY_LAKE;
    input.bodyId[0] = 42;
    input.bodyMask[1] = 1;
    input.bodyKind[1] = HYDROLOGY_BODY_RIVER;
    input.bodyId[1] = 99;

    const sample = sampleTile(input, 0.75, 0.1);

    expect(sample.bodyKind).toBe(HYDROLOGY_BODY_RIVER);
    expect(sample.bodyId).toBe(99);
  });

  it("returns a dry canonical sample instead of inventing an identity", () => {
    const input = identityTile();
    input.bodyMask[0] = 1;
    input.bodyKind[0] = HYDROLOGY_BODY_LAKE;

    const sample = sampleTile(input, 0.25, 0.25);

    expect(sample.bodyMask).toBe(0);
    expect(sample.depth).toBe(0);
    expect(sample.bodyKind).toBe(HYDROLOGY_BODY_DRY);
    expect(sample.bodyId).toBe(0);
  });
});
