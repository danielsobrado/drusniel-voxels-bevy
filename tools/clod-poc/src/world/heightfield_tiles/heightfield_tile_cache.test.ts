import { describe, expect, it } from "vitest";
import { buildHeightfieldTile, type HeightfieldTile } from "./heightfield_tile.js";
import {
  HeightfieldTileCache,
  planHeightfieldTileKeys,
  type HeightfieldTileBatchBuilder,
  type HeightfieldTileBuildResult,
} from "./heightfield_tile_cache.js";
import type { HeightfieldTileConfig } from "./heightfield_tile_config.js";
import type { WorldTileKey } from "../tile_key.js";

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
});
