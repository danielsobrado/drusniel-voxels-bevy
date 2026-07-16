import { describe, expect, it } from "vitest";
import { buildHeightfieldTile, type HeightfieldTile } from "./heightfield_tile.js";
import {
  HeightfieldTileCache,
  planHeightfieldTileKeys,
  type HeightfieldTileBatchBuilder,
  type HeightfieldTileBuildResult,
} from "./heightfield_tile_cache.js";
import type { HeightfieldTileConfig } from "./heightfield_tile_config.js";
import { tileKeyString, WORLD_TILE_SIZE_M, type WorldTileKey } from "../tile_key.js";

function config(overrides: Partial<HeightfieldTileConfig> = {}): HeightfieldTileConfig {
  return {
    enabled: true,
    radiusM: 0,
    maxResidentTiles: 4,
    maxInflightBatches: 1,
    maxTilesPerBatch: 2,
    evictDistanceMultiplier: 1,
    retryCooldownFrames: 10,
    predictionSeconds: 0,
    persistenceEnabled: false,
    ...overrides,
  };
}

function tile(key: WorldTileKey, sourceRevision = 0): HeightfieldTile {
  return buildHeightfieldTile(key, { sampleHeight: (x, z) => x * 0.25 + z * 0.5 }, sourceRevision);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("planHeightfieldTileKeys", () => {
  it("plans nearest-first across negative coordinates", () => {
    const planned = planHeightfieldTileKeys(-128, -128, 0);
    expect(planned[0]?.key).toEqual({ x: -1, z: -1 });
    expect(planned[0]?.distance).toBe(0);
  });
});

describe("HeightfieldTileCache", () => {
  it("emits a surface commit when a tile becomes resident", async () => {
    const committed: HeightfieldTile[] = [];
    const cache = new HeightfieldTileCache(
      config(),
      0,
      async (keys, revision) => ({ tiles: keys.map((key) => tile(key, revision)), buildMs: 1 }),
      null,
      (residentTile) => committed.push(residentTile),
    );

    cache.update({ x: 128, z: 128, frameIndex: 1 });
    await drainMicrotasks();

    expect(committed).toHaveLength(1);
    expect(committed[0]?.key).toEqual({ x: 0, z: 0 });
  });

  it("respects the batch budget and applies resolved tiles", async () => {
    const first = deferred<HeightfieldTileBuildResult>();
    const calls: WorldTileKey[][] = [];
    const builder: HeightfieldTileBatchBuilder = (keys) => {
      calls.push([...keys]);
      return first.promise;
    };
    const cache = new HeightfieldTileCache(config({ radiusM: 300, maxResidentTiles: 16 }), 3, builder);

    cache.update({ x: 128, z: 128, frameIndex: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.length).toBeLessThanOrEqual(2);
    expect(cache.counters().inflight).toBe(calls[0]!.length);

    first.resolve({ tiles: calls[0]!.map((key) => tile(key, 3)), buildMs: 4.5 });
    await drainMicrotasks();

    expect(cache.counters().resident).toBe(calls[0]!.length);
    expect(cache.counters().buildsTotal).toBe(calls[0]!.length);
    expect(cache.counters().buildMsP95).toBe(4.5);
  });

  it("plans while blocked and dispatches after streamed-root work drains", async () => {
    const calls: WorldTileKey[][] = [];
    const builder: HeightfieldTileBatchBuilder = async (keys, revision) => {
      calls.push([...keys]);
      return { tiles: keys.map((key) => tile(key, revision)), buildMs: 1 };
    };
    const cache = new HeightfieldTileCache(config(), 0, builder);

    cache.update({ x: 128, z: 128, frameIndex: 1, buildAllowed: false });
    expect(cache.counters().required).toBe(1);
    expect(cache.counters().pending).toBe(1);
    expect(calls).toHaveLength(0);

    cache.update({ x: 128, z: 128, frameIndex: 2, buildAllowed: true });
    await drainMicrotasks();
    expect(calls).toHaveLength(1);
    expect(cache.counters().resident).toBe(1);
  });

  it("ignores a worker result that resolves after disposal", async () => {
    const pending = deferred<HeightfieldTileBuildResult>();
    const calls: WorldTileKey[][] = [];
    const cache = new HeightfieldTileCache(config(), 0, (keys) => {
      calls.push([...keys]);
      return pending.promise;
    });

    cache.update({ x: 128, z: 128, frameIndex: 1 });
    cache.clear();
    pending.resolve({ tiles: calls[0]!.map((key) => tile(key)), buildMs: 1 });
    await drainMicrotasks();

    expect(cache.counters().resident).toBe(0);
    expect(cache.counters().buildsTotal).toBe(0);
    expect(cache.counters().inflight).toBe(0);
  });

  it("evicts old tiles after the required ring moves", async () => {
    const builder: HeightfieldTileBatchBuilder = async (keys, revision) => ({
      tiles: keys.map((key) => tile(key, revision)),
      buildMs: 1,
    });
    const cache = new HeightfieldTileCache(config({ maxResidentTiles: 1 }), 0, builder);

    cache.update({ x: 128, z: 128, frameIndex: 1 });
    await drainMicrotasks();
    expect(cache.counters().resident).toBe(1);

    cache.update({ x: 128 + 1024, z: 128, frameIndex: 2 });
    await drainMicrotasks();
    expect(cache.counters().resident).toBe(1);
    expect(cache.counters().evictionsTotal).toBeGreaterThan(0);
  });

  it("remains planner-only when no builder is installed", () => {
    const cache = new HeightfieldTileCache(config({ radiusM: 300 }), 0, null);
    cache.update({ x: 128, z: 128, frameIndex: 1 });

    expect(cache.counters().required).toBeGreaterThan(0);
    expect(cache.counters().pending).toBe(cache.counters().required);
    expect(cache.counters().resident).toBe(0);
    expect(cache.counters().inflight).toBe(0);
  });

  it("retries failed builds only after cooldown", async () => {
    let calls = 0;
    const builder: HeightfieldTileBatchBuilder = async (keys, revision) => {
      calls++;
      if (calls === 1) throw new Error("synthetic failure");
      return { tiles: keys.map((key) => tile(key, revision)), buildMs: 1 };
    };
    const cache = new HeightfieldTileCache(config({ retryCooldownFrames: 10 }), 0, builder);

    cache.update({ x: 128, z: 128, frameIndex: 1 });
    await drainMicrotasks();
    expect(calls).toBe(1);
    expect(cache.counters().failuresTotal).toBe(1);

    cache.update({ x: 128, z: 128, frameIndex: 5 });
    await drainMicrotasks();
    expect(calls).toBe(1);

    cache.update({ x: 128, z: 128, frameIndex: 11 });
    await drainMicrotasks();
    expect(calls).toBe(2);
    expect(cache.counters().resident).toBe(1);
  });

  it("tracks procedural fallback samples", () => {
    const cache = new HeightfieldTileCache(config(), 0, null);
    cache.recordFallbackSample();
    cache.recordFallbackSample(3);
    expect(cache.counters().fallbackSamplesTotal).toBe(4);
  });

  it("reports fallback samples recorded per frame so a settled scene can be gated", () => {
    const cache = new HeightfieldTileCache(config(), 0, null);

    cache.update({ x: 0, z: 0, frameIndex: 1 });
    cache.recordFallbackSample(5);
    expect(cache.counters().fallbackSamplesTotal).toBe(5);

    cache.update({ x: 0, z: 0, frameIndex: 2 });
    expect(cache.counters().fallbackSamplesThisFrame).toBe(5);

    cache.recordFallbackSample(2);
    cache.update({ x: 0, z: 0, frameIndex: 3 });
    expect(cache.counters().fallbackSamplesThisFrame).toBe(2);

    cache.update({ x: 0, z: 0, frameIndex: 4 });
    expect(cache.counters().fallbackSamplesThisFrame).toBe(0);
    expect(cache.counters().fallbackSamplesTotal).toBe(7);
  });

  it("keeps physical inflight accounting and current-epoch tile ownership across invalidation", async () => {
    const requests: Array<{
      keys: WorldTileKey[];
      resolve: (result: HeightfieldTileBuildResult) => void;
    }> = [];
    let activeBuilds = 0;
    let maxActiveBuilds = 0;
    const builder: HeightfieldTileBatchBuilder = (keys) => {
      const pending = deferred<HeightfieldTileBuildResult>();
      activeBuilds++;
      maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
      requests.push({ keys: [...keys], resolve: pending.resolve });
      return pending.promise.finally(() => {
        activeBuilds--;
      });
    };
    const cache = new HeightfieldTileCache(config({
      radiusM: 300,
      maxResidentTiles: 16,
      maxInflightBatches: 2,
      maxTilesPerBatch: 1,
    }), 0, builder);

    cache.update({ x: 128, z: 128, frameIndex: 1 });
    cache.update({ x: 128, z: 128, frameIndex: 2 });
    expect(requests).toHaveLength(2);
    const staleRequests = requests.slice();
    expect(new Set(staleRequests.map((request) => tileKeyString(request.keys[0]!))).size).toBe(2);

    const invalidatedKey = staleRequests[0]!.keys[0]!;
    const minX = invalidatedKey.x * WORLD_TILE_SIZE_M;
    const minZ = invalidatedKey.z * WORLD_TILE_SIZE_M;
    expect(cache.invalidateBounds({
      minX,
      minZ,
      maxX: minX + WORLD_TILE_SIZE_M,
      maxZ: minZ + WORLD_TILE_SIZE_M,
    })).toBe(1);
    cache.update({ x: 128, z: 128, frameIndex: 3 });
    expect(requests).toHaveLength(2);

    staleRequests[1]!.resolve({
      tiles: staleRequests[1]!.keys.map((key) => tile(key)),
      buildMs: 1,
    });
    await drainMicrotasks();
    await drainMicrotasks();
    cache.update({ x: 128, z: 128, frameIndex: 4 });
    expect(requests).toHaveLength(3);
    expect(tileKeyString(requests[2]!.keys[0]!)).toBe(tileKeyString(staleRequests[0]!.keys[0]!));

    staleRequests[0]!.resolve({
      tiles: staleRequests[0]!.keys.map((key) => tile(key)),
      buildMs: 1,
    });
    await drainMicrotasks();
    await drainMicrotasks();
    cache.update({ x: 128, z: 128, frameIndex: 5 });
    expect(requests).toHaveLength(4);

    const currentEpochIds = requests.slice(staleRequests.length)
      .map((request) => tileKeyString(request.keys[0]!));
    expect(new Set(currentEpochIds).size).toBe(currentEpochIds.length);
    expect(maxActiveBuilds).toBeLessThanOrEqual(2);

    cache.clear();
    for (const request of requests.slice(staleRequests.length)) {
      request.resolve({ tiles: request.keys.map((key) => tile(key)), buildMs: 1 });
    }
    await drainMicrotasks();
    await drainMicrotasks();
    expect(activeBuilds).toBe(0);
    expect((cache as unknown as { inflightBatches: number }).inflightBatches).toBe(0);
  });

  it("rebuilds invalidated bounds without reloading stale persisted tiles", async () => {
    let builds = 0;
    const cache = new HeightfieldTileCache(
      config(),
      0,
      async (keys, revision) => {
        builds++;
        return {
          tiles: keys.map((key) => buildHeightfieldTile(key, { sampleHeight: () => 99 }, revision)),
          buildMs: 1,
        };
      },
      {
        load: async (key, revision) => tile(key, revision),
        save: async () => {},
      },
    );

    cache.update({ x: 128, z: 128, frameIndex: 1 });
    await drainMicrotasks();
    expect(builds).toBe(0);

    expect(cache.invalidateBounds({ minX: 0, minZ: 0, maxX: 256, maxZ: 256 })).toBe(1);
    await drainMicrotasks();

    expect(builds).toBe(1);
    expect(cache.get({ x: 0, z: 0 })?.heights[0]).toBe(99);
  });
});
