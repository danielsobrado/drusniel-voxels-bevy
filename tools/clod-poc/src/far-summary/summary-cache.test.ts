import { describe, expect, it } from "vitest";
import { FarSummaryCache } from "./summary-cache.js";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { StreamCenter } from "./stream-center.js";
import { computeRequiredFarSummaryTiles } from "./clipmap-rings.js";
import { ProceduralWorldSource } from "../world_source/world_source.js";
import { resolveTerrainFieldConfig } from "../terrain/terrain.js";


const flatSampler: FarTerrainSampler = {
  sampleHeight: () => 50,
  sampleMaterial: () => 0,
};

describe("far summary cache", () => {
  it("defers a completed base tile until enrichment publishes it", () => {
    const config = structuredClone(DEFAULT_FAR_SUMMARY_CONFIG);
    config.stream.maxTileBuildsPerFrame = 1;
    config.stream.maxTileCommitsPerFrame = 1;
    const cache = new FarSummaryCache(config);
    const requests = computeRequiredFarSummaryTiles({
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    }, config);
    const deferred: Parameters<FarSummaryCache["commitExternalTile"]>[0][] = [];

    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(flatSampler, 0, 0, 1, Number.POSITIVE_INFINITY, (tile) => deferred.push(tile));

    expect(deferred).toHaveLength(1);
    expect(cache.countRequestStates(requests).ready).toBe(0);
    expect(cache.getTile(deferred[0]!.key)?.state).toBe("building");

    cache.commitExternalTile(deferred[0]!);
    expect(cache.countRequestStates(requests).ready).toBe(1);
  });

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

  it("counts request states from the current request set", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.stream.maxTileBuildsPerFrame = 500;
    config.stream.maxTileCommitsPerFrame = 500;
    const cache = new FarSummaryCache(config);
    const centerA: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };
    const centerB: StreamCenter = {
      worldX: 30000, worldZ: 30000,
      predictedX: 30000, predictedZ: 30000,
      velocityX: 0, velocityZ: 0,
    };

    const requestsA = computeRequiredFarSummaryTiles(centerA, config);
    cache.requestTiles(requestsA, 0, 0);
    cache.buildSomeTiles(flatSampler, 0, 0);
    expect(cache.countRequestStates(requestsA).ready).toBeGreaterThan(0);

    const requestsB = computeRequiredFarSummaryTiles(centerB, config);
    const statesB = cache.countRequestStates(requestsB);
    expect(statesB.missing).toBeGreaterThan(0);
    expect(statesB.ready).toBeLessThan(requestsB.length);
  });

  it("builds far-summary material ids from ProceduralWorldSource", () => {
    const terrain = resolveTerrainFieldConfig({ seed: 7, islandShape: { enabled: true } });
    const source = new ProceduralWorldSource(terrain);
    const sampler: FarTerrainSampler = {
      sampleHeight: (x, z) => source.sampleHeight(x, z),
      sampleMaterial: (x, z) => source.sampleMaterial(x, z),
      sampleWaterCoverageForHeight: (_x, _z, height) => height < source.metadata.seaLevel ? 1 : 0,
    };
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.stream.maxTileBuildsPerFrame = 1000;
    config.stream.maxTileCommitsPerFrame = 1000;
    const cache = new FarSummaryCache(config);
    const center: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };

    const requests = computeRequiredFarSummaryTiles(center, config);
    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(sampler, 0, 0);

    const materials = new Set<number>();
    cache.forEachTile((tile) => {
      if (tile.state !== "ready") return;
      for (const sample of tile.samples) materials.add(sample.dominantMaterial);
    });

    expect(materials.size).toBeGreaterThanOrEqual(2);
  });

  describe("cache hit/miss stats", () => {
    it("hit increments only cacheHits", () => {
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
      cache.requestTiles(requests, 0, 0);
      cache.buildSomeTiles(flatSampler, 0, 0);

      cache.sample(2500, 2500, 0);
      const stats = cache.getStats();
      expect(stats.cacheHits).toBeGreaterThan(0);
      expect(stats.cacheMisses).toBe(0);
    });

    it("missing tile increments only cacheMisses", () => {
      const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
      const cache = new FarSummaryCache(config);
      // No tiles built — sampling always misses
      cache.sample(99999, 99999, 0);
      const stats = cache.getStats();
      expect(stats.cacheMisses).toBeGreaterThan(0);
      expect(stats.cacheHits).toBe(0);
    });

    it("repeated calls produce correct totals", () => {
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
      cache.requestTiles(requests, 0, 0);
      cache.buildSomeTiles(flatSampler, 0, 0);

      // 3 hits + 2 misses
      cache.sample(2500, 2500, 0);
      cache.sample(2600, 2500, 0);
      cache.sample(2500, 2600, 0);
      cache.sample(99999, 99999, 0);
      cache.sample(-99999, -99999, 0);

      const stats = cache.getStats();
      expect(stats.cacheHits).toBeGreaterThanOrEqual(3);
      expect(stats.cacheMisses).toBeGreaterThanOrEqual(2);
      expect(stats.cacheHits + stats.cacheMisses).toBe(5);
    });
  });

  describe("tile sampling", () => {
    it("bilinearly samples height at center-aligned positions", () => {
      const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
      config.stream.maxTileBuildsPerFrame = 500;
      config.stream.maxTileCommitsPerFrame = 500;
      const gradientSampler: FarTerrainSampler = {
        sampleHeight: (x, z) => x + z,
        sampleMaterial: (x) => x < 2080 ? 1 : 2,
      };
      const cache = new FarSummaryCache(config);
      const center: StreamCenter = {
        worldX: 0, worldZ: 0,
        predictedX: 0, predictedZ: 0,
        velocityX: 0, velocityZ: 0,
      };

      const requests = computeRequiredFarSummaryTiles(center, config);
      cache.requestTiles(requests, 0, 0);
      cache.buildSomeTiles(gradientSampler, 0, 0);

      expect(cache.sample(2064, 2064, 0)?.heightAvg).toBe(4128);
      const midpoint = cache.sample(2080, 2080, 0);
      expect(midpoint?.heightAvg).toBe(4160);
      expect(midpoint?.dominantMaterial).toBe(2);
    });

    it("preserves and interpolates layout-v2 channels", () => {
      const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
      config.stream.maxTileBuildsPerFrame = 500;
      config.stream.maxTileCommitsPerFrame = 500;
      const sampler: FarTerrainSampler = {
        sampleHeight: () => 40,
        sampleWaterSummary: (x) => ({
          coverage: 1,
          waterLevel: x,
          bodyKind: x < 2080 ? 1 : 2,
          shoreDistance: x * 0.5,
          flowX: 0.25,
          flowZ: -0.5,
        }),
        sampleCanopySummary: (x) => ({
          coverage: 0.5,
          canopyHeightAvg: 60 + x * 0.01,
          speciesPine: 0.2,
          speciesBroadleaf: 0.7,
          speciesDeadwood: 0.1,
        }),
      };
      const cache = new FarSummaryCache(config);
      const requests = computeRequiredFarSummaryTiles({
        worldX: 0, worldZ: 0,
        predictedX: 0, predictedZ: 0,
        velocityX: 0, velocityZ: 0,
      }, config);
      cache.requestTiles(requests, 0, 0);
      cache.buildSomeTiles(sampler, 0, 0);

      const midpoint = cache.sample(2080, 2080, 0)!;
      expect(midpoint.waterLevel).toBe(2080);
      expect(midpoint.bodyKind).toBe(2);
      expect(midpoint.shoreDistance).toBe(1040);
      expect(midpoint.flowX).toBe(0.25);
      expect(midpoint.flowZ).toBe(-0.5);
      expect(midpoint.canopyHeightAvg).toBeCloseTo(80.64, 5);
      expect(midpoint.speciesBroadleaf).toBeCloseTo(0.7, 6);
    });
  });

  describe("stale tile lifecycle", () => {
    it("stale tile remains sampleable while rebuild is pending", () => {
      const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
      config.stream.maxTileBuildsPerFrame = 500;
      config.stream.maxTileCommitsPerFrame = 500;
      config.stream.keepStaleUntilReplacement = true;
      const cache = new FarSummaryCache(config);

      const center: StreamCenter = {
        worldX: 0, worldZ: 0,
        predictedX: 0, predictedZ: 0,
        velocityX: 0, velocityZ: 0,
      };
      const requests = computeRequiredFarSummaryTiles(center, config);
      cache.requestTiles(requests, 0, 0);
      cache.buildSomeTiles(flatSampler, 0, 0);
      let stats = cache.getStats();
      expect(stats.readyTiles).toBeGreaterThan(0);

      // Advance frameIndex (without cooling the tile) so markStale catches it
      cache.evictColdTiles(2, 0);
      cache.markStale(null);
      stats = cache.getStats();
      expect(stats.staleTiles).toBeGreaterThan(0);

      // Stale tile should still be sampleable
      const sample = cache.sample(2500, 2500, 0);
      expect(sample).not.toBeNull();
    });

    it("stale tile is a miss when stale replacement sampling is disabled", () => {
      const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
      config.stream.maxTileBuildsPerFrame = 500;
      config.stream.maxTileCommitsPerFrame = 500;
      config.stream.keepStaleUntilReplacement = false;
      const cache = new FarSummaryCache(config);
      const center: StreamCenter = {
        worldX: 0, worldZ: 0,
        predictedX: 0, predictedZ: 0,
        velocityX: 0, velocityZ: 0,
      };
      const requests = computeRequiredFarSummaryTiles(center, config);
      cache.requestTiles(requests, 0, 0);
      cache.buildSomeTiles(flatSampler, 0, 0);

      cache.markStale(null);

      expect(cache.sample(2500, 2500, 0)).toBeNull();
    });

    it("markStale(bounds) only invalidates intersecting tiles", () => {
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
      cache.requestTiles(requests, 0, 0);
      cache.buildSomeTiles(flatSampler, 0, 0);

      cache.markStale({ minX: 2048, maxX: 3072, minZ: 2048, maxZ: 3072 });

      const intersecting = cache.getTile({ ring: 0, x: 2, z: 2, cellSizeM: 32 });
      const outside = cache.getTile({ ring: 0, x: -3, z: -3, cellSizeM: 32 });
      expect(intersecting?.state).toBe("stale");
      expect(outside?.state).toBe("ready");
    });

    it("commit budget exhaustion preserves stale state and retries next frame", () => {
      const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
      config.stream.maxTileBuildsPerFrame = 500;
      config.stream.maxTileCommitsPerFrame = 0; // Block all commits
      const cache = new FarSummaryCache(config);

      const center: StreamCenter = {
        worldX: 0, worldZ: 0,
        predictedX: 0, predictedZ: 0,
        velocityX: 0, velocityZ: 0,
      };
      const requests = computeRequiredFarSummaryTiles(center, config);
      cache.requestTiles(requests, 0, 0);
      cache.buildSomeTiles(flatSampler, 0, 0);

      // Frame 0: budget exhausted, so completed builds wait in the pending commit queue.
      let stats = cache.getStats();
      expect(stats.tilesCommittedThisFrame).toBe(0);
      expect(stats.staleTiles).toBe(0);
      expect(stats.buildingTiles).toBeGreaterThan(0);
      expect(stats.readyTiles).toBe(0);

      // Frame 1: still no commit budget — pending commits are retained, not rebuilt away.
      cache.requestTiles(requests, 1, 16);
      cache.buildSomeTiles(flatSampler, 1, 16);
      stats = cache.getStats();
      expect(stats.tilesCommittedThisFrame).toBe(0);
      expect(stats.buildingTiles).toBeGreaterThan(0);

      // Frame 2: now allow commits
      config.stream.maxTileCommitsPerFrame = 500;
      cache.requestTiles(requests, 2, 32);
      cache.buildSomeTiles(flatSampler, 2, 32);
      stats = cache.getStats();
      expect(stats.tilesCommittedThisFrame).toBeGreaterThan(0);
      expect(stats.readyTiles).toBeGreaterThan(0);

      // After commit, samples should work
      const sample = cache.sample(2500, 2500, 0);
      expect(sample).not.toBeNull();
    });
  });
});
