import { beforeEach, describe, expect, it } from "vitest";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../stream/terrain_streaming_control.js";
import {
  createEmptyStreamRootCacheStats,
  streamRootCacheOperationIsCurrent,
} from "./clodStreamRootCache.js";

beforeEach(() => resetTerrainStreamingControlForTests());

describe("stream-root cache streaming token", () => {
  it("rejects cache work captured before a pause generation change", () => {
    const stats = createEmptyStreamRootCacheStats();
    expect(streamRootCacheOperationIsCurrent(stats)).toBe(true);

    setTerrainStreamingEnabled(false);
    setTerrainStreamingEnabled(true);

    expect(streamRootCacheOperationIsCurrent(stats)).toBe(false);
    expect(streamRootCacheOperationIsCurrent(createEmptyStreamRootCacheStats())).toBe(true);
  });
});
