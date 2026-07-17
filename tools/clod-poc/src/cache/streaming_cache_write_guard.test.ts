import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import type { CacheRpcRequest } from "./cacheWorkerRpc.js";
import { commitCachePut, type CacheWriteStore } from "./streaming_cache_write_guard.js";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../stream/terrain_streaming_control.js";

function record(generation: number | undefined, createdAtUnixMs = 1): ClodCacheStoredRecord {
  return {
    header: {
      schemaVersion: 1,
      artifactKind: "clod-stream-root-node",
      key: "stream-root",
      createdAtUnixMs,
      builderVersion: "test",
      generatorVersion: "test",
      worldSeed: "test",
      sourceRevision: "0",
      configHash: "test",
      sourceHash: "test",
      uncompressedBytes: 1,
      storedBytes: 1,
      compression: "none",
      checksum: `checksum-${createdAtUnixMs}`,
      metadata: generation === undefined ? {} : { terrainStreamingGeneration: generation },
    },
    payload: new Uint8Array([createdAtUnixMs]).buffer,
  };
}

function request(
  cacheRecord: ClodCacheStoredRecord,
  streamingGeneration?: number,
): Extract<CacheRpcRequest, { op: "put" }> {
  return {
    type: "cacheRpc",
    requestId: 1,
    op: "put",
    key: "stream-root",
    record: cacheRecord,
    ...(streamingGeneration === undefined ? {} : { streamingGeneration }),
  };
}

beforeEach(() => resetTerrainStreamingControlForTests());

describe("commitCachePut", () => {
  it("does not apply terrain-streaming state to unrelated cache writes", async () => {
    setTerrainStreamingEnabled(false);
    const put = vi.fn(async () => undefined);
    const store: CacheWriteStore = {
      get: async () => null,
      put,
      delete: async () => undefined,
    };

    await expect(commitCachePut(store, request(record(undefined)))).resolves.toBe(true);
    expect(put).toHaveBeenCalledOnce();
  });

  it("removes the exact streamed-root record when its generation changes during the write", async () => {
    let stored: ClodCacheStoredRecord | null = null;
    const remove = vi.fn(async () => { stored = null; });
    const store: CacheWriteStore = {
      get: async () => stored,
      put: async (_key, value) => {
        stored = value;
        setTerrainStreamingEnabled(false);
        setTerrainStreamingEnabled(true);
      },
      delete: remove,
    };

    await expect(commitCachePut(store, request(record(0), 0))).resolves.toBe(false);
    expect(remove).toHaveBeenCalledWith("stream-root");
    expect(stored).toBeNull();
  });

  it("does not delete a newer replacement written under the resumed generation", async () => {
    let stored: ClodCacheStoredRecord | null = null;
    const newer = record(2, 2);
    const remove = vi.fn(async () => { stored = null; });
    const store: CacheWriteStore = {
      get: async () => stored,
      put: async () => {
        setTerrainStreamingEnabled(false);
        setTerrainStreamingEnabled(true);
        stored = newer;
      },
      delete: remove,
    };

    await expect(commitCachePut(store, request(record(0), 0))).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(stored).toBe(newer);
  });
});
