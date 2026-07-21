import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createSunLightCacheRuntime } from "../far_light_cache_runtime.js";
import { parseSunLightOptions } from "../sun_light_options.js";

function provider() {
  return {
    terrainRevision: () => 1,
    propOcclusionRevision: () => 0,
    setPropOcclusion: () => undefined,
    heightAt: () => 0,
    readHeight: () => ({ height: 0, present: true, revision: 1 }),
    tileRevision: () => 1,
  };
}

describe("sun light cache", () => {
  it("queues before first budgeted build, then hits warm cache", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 4 },
      ray: { max_distance_world: 16, step_world: 4 },
      build: { max_build_ms_per_frame: 999 },
    });
    const cache = createSunLightCacheRuntime(options);
    const p = provider();
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, new THREE.Vector3(1, 1, 0), 1, p);
    expect(cache.stats().pendingTiles).toBe(1);
    cache.updateBudgeted(p, 1, performance.now());
    expect(cache.stats().entries).toBe(1);
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, new THREE.Vector3(1, 1, 0), 2, p);
    expect(cache.stats().hits).toBeGreaterThan(0);
  });

  it("respects max tiles per frame", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 4 },
      ray: { max_distance_world: 16, step_world: 4 },
      build: { max_tiles_per_frame: 1, max_build_ms_per_frame: 999 },
    });
    const cache = createSunLightCacheRuntime(options);
    const p = provider();
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, new THREE.Vector3(1, 1, 0), 1, p);
    cache.enqueueTile({ tileX: 1, tileZ: 0, lod: 0 }, new THREE.Vector3(1, 1, 0), 1, p);
    cache.updateBudgeted(p, 1, performance.now());
    expect(cache.stats().tilesBuiltThisFrame).toBe(1);
    expect(cache.stats().pendingTiles).toBe(1);
  });

  it("keeps an in-progress build across frames under a tiny budget and completes it without duplicates", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 8 },
      ray: { max_distance_world: 16, step_world: 4 },
      build: { max_tiles_per_frame: 2, max_build_ms_per_frame: 0.000001 },
    });
    const cache = createSunLightCacheRuntime(options);
    const p = provider();
    const sun = new THREE.Vector3(1, 0.2, 0);
    let frame = 1;
    let guard = 0;
    while (cache.stats().entries < 1 && ++guard < 100000) {
      // the runtime re-enqueues the ring every frame, like light_update does
      cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, sun, frame, p);
      cache.updateBudgeted(p, frame, performance.now(), { tileX: 0, tileZ: 0, lod: 0 });
      frame++;
    }
    expect(cache.stats().entries).toBe(1);
    expect(frame).toBeGreaterThan(2);
    // the duplicate pending copies accumulated during the build must not trigger a rebuild
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, sun, frame, p);
    cache.updateBudgeted(p, frame, performance.now(), { tileX: 0, tileZ: 0, lod: 0 });
    expect(cache.stats().tilesBuiltThisFrame).toBe(0);
    expect(cache.stats().pendingTiles).toBe(0);
  });

  it("builds nearest tiles first and prunes pending tiles far outside the ring", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 4 },
      ray: { max_distance_world: 16, step_world: 4 },
      build: { max_tiles_per_frame: 1, max_build_ms_per_frame: 999, material_tile_radius: 2 },
    });
    const cache = createSunLightCacheRuntime(options);
    const p = provider();
    const sun = new THREE.Vector3(1, 1, 0);
    cache.enqueueTile({ tileX: 40, tileZ: 0, lod: 0 }, sun, 1, p); // far outside radius+margin
    cache.enqueueTile({ tileX: 1, tileZ: 0, lod: 0 }, sun, 1, p);
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, sun, 1, p);
    cache.updateBudgeted(p, 1, performance.now(), { tileX: 0, tileZ: 0, lod: 0 });
    expect(cache.stats().tilesBuiltThisFrame).toBe(1);
    // nearest tile (0,0) built first, out-of-ring tile pruned, (1,0) still pending
    expect(cache.stats().entries).toBe(1);
    expect(cache.stats().pendingTiles).toBe(1);
    expect(cache.peekWorld(16, 16, sun, p).kind).not.toBe("pending");
  });

  it("invalidates only entries within ray reach of a changed region", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 4 },
      ray: { max_distance_world: 16, step_world: 4 },
      build: { max_tiles_per_frame: 2, max_build_ms_per_frame: 999 },
    });
    const cache = createSunLightCacheRuntime(options);
    const p = provider();
    const sun = new THREE.Vector3(1, 1, 0);
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, sun, 1, p);
    cache.enqueueTile({ tileX: 10, tileZ: 0, lod: 0 }, sun, 1, p);
    cache.updateBudgeted(p, 1, performance.now());
    expect(cache.stats().entries).toBe(2);
    // region at x 0..1 reaches tile 0 (0..32) but not tile 10 (320..352, reach 16)
    cache.invalidateRegions([{ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }]);
    expect(cache.stats().entries).toBe(1);
    expect(cache.peekWorld(336, 16, sun, p).kind).not.toBe("pending");
    expect(cache.peekWorld(16, 16, sun, p).kind).toBe("pending");
  });

  it("keeps an in-progress build when the changed region does not intersect it", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 8 },
      ray: { max_distance_world: 16, step_world: 4 },
      build: { max_tiles_per_frame: 1, max_build_ms_per_frame: 0.000001 },
    });
    const cache = createSunLightCacheRuntime(options);
    const p = provider();
    const sun = new THREE.Vector3(1, 0.2, 0);
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, sun, 1, p);
    cache.updateBudgeted(p, 1, performance.now(), { tileX: 0, tileZ: 0, lod: 0 });
    // tiny budget: the tile is mid-build, counted in pendingTiles
    expect(cache.stats().entries).toBe(0);
    expect(cache.stats().pendingTiles).toBe(1);
    cache.invalidateRegions([{ minX: 1000, minZ: 1000, maxX: 1001, maxZ: 1001 }]);
    expect(cache.stats().pendingTiles).toBe(1);
    cache.invalidateRegions([{ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }]);
    expect(cache.stats().pendingTiles).toBe(0);
  });

  it("drops an in-progress build when the sun bin changes", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 8 },
      ray: { max_distance_world: 16, step_world: 4 },
      build: { max_tiles_per_frame: 1, max_build_ms_per_frame: 0.000001 },
    });
    const cache = createSunLightCacheRuntime(options);
    const p = provider();
    const sunA = new THREE.Vector3(1, 0.2, 0);
    const sunB = new THREE.Vector3(0, 0.2, 1);
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, sunA, 1, p);
    cache.updateBudgeted(p, 1, performance.now(), { tileX: 0, tileZ: 0, lod: 0 });
    expect(cache.stats().pendingTiles).toBe(1); // bin-A build in progress
    let frame = 2;
    let guard = 0;
    while (cache.stats().entries < 1 && ++guard < 100000) {
      cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, sunB, frame, p);
      cache.updateBudgeted(p, frame, performance.now(), { tileX: 0, tileZ: 0, lod: 0 });
      frame++;
    }
    expect(cache.stats().entries).toBe(1);
    expect(cache.peekWorld(16, 16, sunB, p).kind).not.toBe("pending");
    expect(cache.peekWorld(16, 16, sunA, p).kind).toBe("pending");
  });

  it("bumps contentRevision only when the built tile set changes", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 4 },
      ray: { max_distance_world: 16, step_world: 4 },
      build: { max_tiles_per_frame: 2, max_build_ms_per_frame: 999 },
    });
    const cache = createSunLightCacheRuntime(options);
    const p = provider();
    const sun = new THREE.Vector3(1, 1, 0);
    const r0 = cache.contentRevision();
    cache.updateBudgeted(p, 1, performance.now());
    expect(cache.contentRevision()).toBe(r0); // nothing queued, nothing changed
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, sun, 1, p);
    cache.updateBudgeted(p, 1, performance.now());
    const r1 = cache.contentRevision();
    expect(r1).toBeGreaterThan(r0);
    cache.updateBudgeted(p, 2, performance.now());
    expect(cache.contentRevision()).toBe(r1); // idle frame
    cache.invalidateRegions([{ minX: 1000, minZ: 1000, maxX: 1001, maxZ: 1001 }]);
    expect(cache.contentRevision()).toBe(r1); // nothing intersected
    cache.invalidateRegions([{ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }]);
    expect(cache.contentRevision()).toBeGreaterThan(r1);
  });

  it("evicts least recently used entries", () => {
    const options = parseSunLightOptions({
      tile: { size_world: 32, resolution: 4 },
      ray: { max_distance_world: 16, step_world: 4 },
      build: { max_tiles_per_frame: 2, max_build_ms_per_frame: 999 },
      cache: { max_entries: 1 },
    });
    const cache = createSunLightCacheRuntime(options);
    const p = provider();
    cache.enqueueTile({ tileX: 0, tileZ: 0, lod: 0 }, new THREE.Vector3(1, 1, 0), 1, p);
    cache.enqueueTile({ tileX: 1, tileZ: 0, lod: 0 }, new THREE.Vector3(1, 1, 0), 1, p);
    cache.updateBudgeted(p, 1, performance.now());
    expect(cache.stats().entries).toBe(1);
    expect(cache.stats().evictions).toBeGreaterThan(0);
  });
});
