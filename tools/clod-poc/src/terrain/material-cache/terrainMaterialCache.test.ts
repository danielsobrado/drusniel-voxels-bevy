import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG } from "./terrainMaterialCacheConfig.js";
import { TerrainMaterialCache } from "./terrainMaterialCache.js";
import type { TerrainMaterialBakePayload, TerrainMaterialCacheKey } from "./terrainMaterialCacheTypes.js";

const key = (revision: number): TerrainMaterialCacheKey => ({
  sourceKind: "far_tile",
  sourceId: "ring:0:1,2",
  sourceRevision: revision,
  materialRevision: 0,
  waterRevision: 0,
  vegetationCoverageRevision: 0,
  bakeMode: "far_summary_tile",
  resolution: 2,
  formatProfile: "test",
});

function payload(byte = 32): TerrainMaterialBakePayload {
  return {
    farColor: { data: new Uint8Array(byte), width: 2, height: 2, format: "rgba8", available: true },
    debug: { unavailableChannels: [], sourceSampleCount: 4, bakeMs: 0.25, uploadMs: 0, usedHeightDerivedNormal: false },
  };
}

describe("TerrainMaterialCache", () => {
  it("queues missing entries and returns ready data after budgeted processing", () => {
    const cache = new TerrainMaterialCache(DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG);
    const first = cache.getOrQueue(key(1), () => payload(), 1);
    expect(first.kind).toBe("fallback");
    cache.processFrame(2, fakeClock());
    const second = cache.getOrQueue(key(1), () => payload(), 3);
    expect(second.kind).toBe("ready");
    expect(cache.counters().terrainMaterialCacheReady).toBe(1);
  });

  it("keeps stale data visible while a revision refresh is queued", () => {
    const cache = new TerrainMaterialCache(DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG);
    cache.getOrQueue(key(1), () => payload(16), 1);
    cache.processFrame(2, fakeClock());
    const stale = cache.getOrQueue(key(2), () => payload(16), 3);
    expect(stale.kind).toBe("fallback");
    expect(stale.kind === "fallback" ? stale.staleEntry?.status : null).toBe("stale");
  });

  it("requeues an invalidated pending entry instead of leaving it stuck", () => {
    const cache = new TerrainMaterialCache(DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG);
    cache.getOrQueue(key(1), () => payload(16), 1);
    cache.invalidateSource("far_tile", "ring:0:1,2");
    cache.getOrQueue(key(1), () => payload(16), 2);
    cache.processFrame(3, fakeClock());

    const lookup = cache.getOrQueue(key(1), () => payload(16), 4);
    expect(lookup.kind).toBe("ready");
    expect(cache.counters().terrainMaterialCacheReady).toBe(1);
  });

  it("increments content revision when baked content changes", () => {
    const cache = new TerrainMaterialCache(DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG);
    const before = cache.contentRevision();
    cache.getOrQueue(key(1), () => payload(16), 1);
    cache.processFrame(2, fakeClock());
    expect(cache.contentRevision()).toBeGreaterThan(before);
  });

  it("prunes least recently used ready entries by byte budget", () => {
    const cfg = { ...DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG, budget: { maxBytes: 20 } };
    const cache = new TerrainMaterialCache(cfg);
    cache.getOrQueue(key(1), () => payload(32), 1);
    cache.processFrame(2, fakeClock());
    expect(cache.counters().terrainMaterialCacheEvictions).toBeGreaterThan(0);
    expect(cache.counters().terrainMaterialCacheBytes).toBe(0);
  });
});

function fakeClock(): () => number {
  let now = 0;
  return () => {
    now += 0.01;
    return now;
  };
}
