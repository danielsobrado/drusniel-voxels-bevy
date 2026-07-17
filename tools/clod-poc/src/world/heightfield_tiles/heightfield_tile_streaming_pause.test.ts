import { beforeEach, describe, expect, it } from "vitest";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../../stream/terrain_streaming_control.js";
import { buildHeightfieldTile } from "./heightfield_tile.js";
import {
  HeightfieldTileCache,
  type HeightfieldTileBuildResult,
} from "./heightfield_tile_cache.js";
import type { HeightfieldTileConfig } from "./heightfield_tile_config.js";
import { heightfieldTileBackgroundBuildDue } from "./heightfield_tile_client_runtime.js";
import type { WorldTileKey } from "../tile_key.js";

const CONFIG: HeightfieldTileConfig = {
  enabled: true,
  radiusM: 0,
  maxResidentTiles: 4,
  maxInflightBatches: 1,
  maxTilesPerBatch: 1,
  evictDistanceMultiplier: 1,
  retryCooldownFrames: 10,
  predictionSeconds: 0,
  persistenceEnabled: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function tile(key: WorldTileKey) {
  return buildHeightfieldTile(key, { sampleHeight: () => 12 }, 0);
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => resetTerrainStreamingControlForTests());

describe("heightfield tile streaming control", () => {
  it("drops a worker completion after a pause generation change and retries after resume", async () => {
    const first = deferred<HeightfieldTileBuildResult>();
    const second = deferred<HeightfieldTileBuildResult>();
    const calls: WorldTileKey[][] = [];
    const cache = new HeightfieldTileCache(CONFIG, 0, (keys) => {
      calls.push([...keys]);
      return calls.length === 1 ? first.promise : second.promise;
    });

    cache.update({ x: 128, z: 128, frameIndex: 1 });
    expect(calls).toHaveLength(1);

    setTerrainStreamingEnabled(false);
    setTerrainStreamingEnabled(true);
    first.resolve({ tiles: calls[0]!.map(tile), buildMs: 1 });
    await flushAsync();

    expect(cache.counters().resident).toBe(0);
    expect(cache.counters().buildsTotal).toBe(0);

    cache.update({ x: 128, z: 128, frameIndex: 2 });
    expect(calls).toHaveLength(2);
    second.resolve({ tiles: calls[1]!.map(tile), buildMs: 1 });
    await flushAsync();

    expect(cache.counters().resident).toBe(1);
    expect(cache.counters().buildsTotal).toBe(1);
  });

  it("grants the non-authoritative background quota at a bounded cadence", () => {
    expect(heightfieldTileBackgroundBuildDue(0)).toBe(true);
    expect(heightfieldTileBackgroundBuildDue(29)).toBe(false);
    expect(heightfieldTileBackgroundBuildDue(30)).toBe(true);
    expect(heightfieldTileBackgroundBuildDue(31)).toBe(false);
  });
});
