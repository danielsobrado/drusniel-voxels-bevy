import { describe, expect, it } from "vitest";
import { DEFAULT_FAR_SUMMARY_CONFIG, type FarSummaryConfig } from "./config.js";
import { computeRequiredFarSummaryTiles } from "./clipmap-rings.js";
import { FarSummaryCache } from "./summary-cache.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { StreamCenter } from "./stream-center.js";

const center: StreamCenter = {
  worldX: 0,
  worldZ: 0,
  predictedX: 0,
  predictedZ: 0,
  velocityX: 0,
  velocityZ: 0,
};

const oldSampler: FarTerrainSampler = {
  sampleHeight: () => 10,
  sampleMaterial: () => 1,
};

const newSampler: FarTerrainSampler = {
  sampleHeight: () => 80,
  sampleMaterial: () => 2,
};

function config(): FarSummaryConfig {
  return {
    ...DEFAULT_FAR_SUMMARY_CONFIG,
    stream: { ...DEFAULT_FAR_SUMMARY_CONFIG.stream },
    rings: DEFAULT_FAR_SUMMARY_CONFIG.rings.map((ring) => ({ ...ring })),
    sampling: { ...DEFAULT_FAR_SUMMARY_CONFIG.sampling },
    debug: { ...DEFAULT_FAR_SUMMARY_CONFIG.debug },
  };
}

describe("far summary invalidation races", () => {
  it("cancels an invalidated active build instead of committing pre-edit samples", () => {
    const cfg = config();
    cfg.stream.maxTileBuildsPerFrame = 1;
    cfg.stream.maxTileCommitsPerFrame = 500;
    const cache = new FarSummaryCache(cfg);
    const requests = computeRequiredFarSummaryTiles(center, cfg);

    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(oldSampler, 0, 0, 1, 0);
    expect(cache.getStats().buildingTiles).toBeGreaterThan(0);

    cache.markStale(null);
    expect(cache.getStats().buildsDiscarded).toBeGreaterThan(0);

    cache.requestTiles(requests, 1, 16);
    cache.buildSomeTiles(newSampler, 1, 16, 500);

    const sample = cache.sample(2500, 2500, 0);
    expect(sample?.heightAvg).toBe(80);
    expect(sample?.dominantMaterial).toBe(2);
  });

  it("drops an invalidated pending commit before it can overwrite stale data", () => {
    const cfg = config();
    cfg.stream.maxTileBuildsPerFrame = 500;
    cfg.stream.maxTileCommitsPerFrame = 0;
    const cache = new FarSummaryCache(cfg);
    const requests = computeRequiredFarSummaryTiles(center, cfg);

    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(oldSampler, 0, 0);
    expect(cache.getStats().tilesCommittedThisFrame).toBe(0);

    cache.markStale({ minX: 2048, maxX: 3072, minZ: 2048, maxZ: 3072 });
    expect(cache.getStats().buildsDiscarded).toBeGreaterThan(0);

    cfg.stream.maxTileCommitsPerFrame = 500;
    cache.requestTiles(requests, 1, 16);
    cache.buildSomeTiles(newSampler, 1, 16);

    const sample = cache.sample(2500, 2500, 0);
    expect(sample?.heightAvg).toBe(80);
    expect(sample?.dominantMaterial).toBe(2);
  });
});
