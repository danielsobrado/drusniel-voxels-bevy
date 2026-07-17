import { beforeEach, describe, expect, it } from "vitest";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../stream/terrain_streaming_control.js";
import {
  beginStreamRootCacheOperation,
  createEmptyStreamRootCacheStats,
  streamRootCacheOperationGeneration,
  streamRootCacheOperationIsCurrent,
} from "./clodStreamRootCache.js";

beforeEach(() => resetTerrainStreamingControlForTests());

describe("stream-root cache streaming token", () => {
  it("rejects cache work captured before a pause generation change", () => {
    const stats = createEmptyStreamRootCacheStats();
    expect(streamRootCacheOperationIsCurrent(stats)).toBe(true);
    expect(streamRootCacheOperationGeneration(stats)).toBe(0);

    setTerrainStreamingEnabled(false);
    setTerrainStreamingEnabled(true);

    expect(streamRootCacheOperationIsCurrent(stats)).toBe(false);
    expect(streamRootCacheOperationGeneration(stats)).toBe(0);
    const currentStats = createEmptyStreamRootCacheStats();
    expect(streamRootCacheOperationGeneration(currentStats)).toBe(2);
    expect(streamRootCacheOperationIsCurrent(currentStats)).toBe(true);
  });

  it("conservatively blocks cache writes while a stale root request is still active", () => {
    const finish = beginStreamRootCacheOperation();
    setTerrainStreamingEnabled(false);
    setTerrainStreamingEnabled(true);

    expect(streamRootCacheOperationIsCurrent(createEmptyStreamRootCacheStats())).toBe(false);

    finish();
    expect(streamRootCacheOperationIsCurrent(createEmptyStreamRootCacheStats())).toBe(true);
  });
});
