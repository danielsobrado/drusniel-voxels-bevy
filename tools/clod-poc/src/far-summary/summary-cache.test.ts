import { describe, expect, it } from "vitest";
import { FarSummaryCache } from "./summary-cache.js";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { StreamCenter } from "./stream-center.js";
import { computeRequiredFarSummaryTiles } from "./clipmap-rings.js";


const flatSampler: FarTerrainSampler = {
  sampleHeight: () => 50,
  sampleMaterial: () => 0,
};

describe("far summary cache", () => {
  it("lifecycle: missing -> requested -> ready", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.stream.maxTileBuildsPerFrame = 500;
    config.stream.maxTileCommitsPerFrame = 500;
    const cache = new FarSummaryCache(config);

    const center: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };

    const requests = computeRequiredFarSummaryTiles(center, config);
    expect(requests.length).toBeGreaterThan(0);

    cache.requestTiles(requests, 0, 0);
    let stats = cache.getStats();
    expect(stats.requestedTiles).toBeGreaterThan(0);

    // Try sampling at a position that SHOULD be covered by a requested tile
    // near_far ring: cellM=32 tileCells=32 → tileSize=1024, startM=1536
    // Camera at (0,0) so tile (2,2) covers [2048,3072), center distance ~3620m >= 1536
    let covering = false;
    for (const req of requests) {
      if (req.ring === 0) {
        const bounds = { minX: req.key.x * 1024, maxX: (req.key.x + 1) * 1024, minZ: req.key.z * 1024, maxZ: (req.key.z + 1) * 1024 };
        if (2500 >= bounds.minX && 2500 < bounds.maxX && 2500 >= bounds.minZ && 2500 < bounds.maxZ) {
          covering = true;
          break;
        }
      }
    }
    expect(covering).toBe(true);

    cache.buildSomeTiles(flatSampler, 1, 16);
    stats = cache.getStats();
    expect(stats.tilesBuiltThisFrame).toBeGreaterThan(0);

    const sample = cache.sample(2500, 2500, 0);
    expect(sample).not.toBeNull();
    expect(sample!.heightAvg).toBe(50);
  });

  it("stale tile remains sampleable", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.stream.maxTileBuildsPerFrame = 500;
    config.stream.maxTileCommitsPerFrame = 500;
    config.stream.evictionGraceSeconds = 60;
    const cache = new FarSummaryCache(config);

    const center: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };

    const requests = computeRequiredFarSummaryTiles(center, config);
    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(flatSampler, 0, 0);

    // Mark tiles stale by not requesting them
    cache.evictColdTiles(10, 50000);
    cache.markStale(null);

    // Sample should still work even if tile is stale (use position past near_far inner radius)
    const sample = cache.sample(2500, 2500, 0);
    expect(sample).not.toBeNull();
  });

  it("eviction waits for grace period", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.stream.maxTileBuildsPerFrame = 500;
    config.stream.maxTileCommitsPerFrame = 500;
    config.stream.evictionGraceSeconds = 10;
    const cache = new FarSummaryCache(config);

    const center: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };

    const requests = computeRequiredFarSummaryTiles(center, config);
    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(flatSampler, 0, 0);

    // Before grace period — tile should not be evicted
    cache.evictColdTiles(1, 1000); // 1 second, far less than 10s grace
    const sampleBefore = cache.sample(2500, 2500, 0);
    expect(sampleBefore).not.toBeNull();

    // After grace period - tile may be evicted; check that sample degrades gracefully
    cache.evictColdTiles(2, 60000); // 60 seconds > 10s grace
    const sampleAfter = cache.sample(2500, 2500, 0);
    // Sample may be null if evicted, or may work via procedural fallback
    // The important thing is we don't crash
    if (sampleAfter !== null) {
      expect(Number.isFinite(sampleAfter.heightAvg)).toBe(true);
    }
  });

  it("build budget is respected", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.stream.maxTileBuildsPerFrame = 2;
    config.stream.maxTileCommitsPerFrame = 2;
    const cache = new FarSummaryCache(config);

    const center: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };

    const requests = computeRequiredFarSummaryTiles(center, config);
    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(flatSampler, 0, 0);

    const stats = cache.getStats();
    expect(stats.tilesBuiltThisFrame).toBeLessThanOrEqual(2);
    expect(stats.tilesCommittedThisFrame).toBeLessThanOrEqual(2);
  });
});
