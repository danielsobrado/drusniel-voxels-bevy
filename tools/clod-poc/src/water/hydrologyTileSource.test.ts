import { describe, expect, it } from "vitest";
import { HydrologyTileCache } from "./hydrologyTileSource.js";
import { sampleInfiniteHydrology } from "./infinite_hydrology.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

// Undulating deterministic terrain so basins/rivers exist and vary in space.
const sampler: TerrainHeightSampler = {
  surfaceHeight: (x: number, z: number) =>
    24 + Math.sin(x * 0.004) * 14 + Math.cos(z * 0.0031) * 11 + Math.sin((x + z) * 0.0012) * 6,
};

const OPTIONS = { tileSizeM: 256, tileRes: 32, maxResidentTiles: 4, drySentinelDepthM: 2 };

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
      // Vertex-aligned coordinates hit stored samples directly (float32 rounding only).
      expect(tile.waterY).toBeCloseTo(analytic.waterY, 3);
      expect(tile.terrainY).toBeCloseTo(analytic.terrainY, 3);
      expect(tile.bodyKind).toBe(analytic.bodyKind);
    }
  });

  it("is continuous across a tile boundary (shared-edge vertices are identical)", () => {
    const cache = new HydrologyTileCache(sampler, OPTIONS);
    const boundaryX = OPTIONS.tileSizeM * 3; // seam between tile 2 and tile 3
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
    cache.sample(5000, 5000); // evicts the first tile (budget 1)
    expect(cache.stats.evictions).toBeGreaterThan(0);
    const again = cache.sample(700, 700); // forces a rebuild
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
});
