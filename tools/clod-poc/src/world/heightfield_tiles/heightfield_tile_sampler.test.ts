import { describe, expect, it } from "vitest";
import { buildStartupHeightfieldRaster } from "../../terrain/startup_heightfield_raster.js";
import { proceduralHeightfieldSampler, startupRasterHeightfieldSampler } from "../heightfield_sampler.js";
import { buildHeightfieldTile } from "./heightfield_tile.js";
import { HeightfieldTileCache } from "./heightfield_tile_cache.js";
import type { HeightfieldTileConfig } from "./heightfield_tile_config.js";
import { heightfieldTileSampler } from "./heightfield_tile_sampler.js";

const CONFIG: HeightfieldTileConfig = {
  enabled: true,
  radiusM: 0,
  maxResidentTiles: 1,
  maxInflightBatches: 1,
  maxTilesPerBatch: 1,
  evictDistanceMultiplier: 1,
  retryCooldownFrames: 1,
  predictionSeconds: 0,
  persistenceEnabled: false,
};

async function residentCache(): Promise<HeightfieldTileCache> {
  const cache = new HeightfieldTileCache(CONFIG, 0, async (keys, revision) => ({
    tiles: keys.map((key) => buildHeightfieldTile(key, { sampleHeight: () => 100 }, revision)),
    buildMs: 1,
  }));
  cache.update({ x: 128, z: 128, frameIndex: 1 });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return cache;
}

describe("heightfieldTileSampler", () => {
  it("uses startup raster, resident tiles, then procedural fallback", async () => {
    const cache = await residentCache();
    const raster = buildStartupHeightfieldRaster(2, () => 50)!;
    const sampler = heightfieldTileSampler(
      cache,
      { ...proceduralHeightfieldSampler(), sampleHeight: () => 7 },
      startupRasterHeightfieldSampler(raster),
    );

    expect(sampler.sampleHeight(0, 0)).toBe(50);
    expect(sampler.sampleHeight(100, 100)).toBe(100);
    expect(sampler.sampleHeight(100.5, 100)).toBe(7);
    expect(cache.counters().fallbackSamplesTotal).toBe(0);

    expect(sampler.sampleHeight(1024, 1024)).toBe(7);
    expect(cache.counters().fallbackSamplesTotal).toBe(1);
  });

  it("selects the positive-side tile at a shared boundary", async () => {
    const cache = new HeightfieldTileCache({ ...CONFIG, maxResidentTiles: 2, radiusM: 300 }, 0, async (keys, revision) => ({
      tiles: keys.map((key) => buildHeightfieldTile(key, { sampleHeight: () => key.x }, revision)),
      buildMs: 1,
    }));
    cache.update({ x: 256, z: 128, frameIndex: 1 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const sampler = heightfieldTileSampler(cache, { ...proceduralHeightfieldSampler(), sampleHeight: () => -1 });

    expect(sampler.sampleHeight(256, 128)).toBe(1);
  });
});
