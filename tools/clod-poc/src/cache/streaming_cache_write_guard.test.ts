import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import type { CacheRpcRequest } from "./cacheWorkerRpc.js";
import {
  cacheRecordVersionMatches,
  commitCachePut,
  type CacheWriteStore,
} from "./streaming_cache_write_guard.js";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../stream/terrain_streaming_control.js";

function record(
  generation: number | undefined,
  createdAtUnixMs = 1,
  cacheWriteId?: string,
): ClodCacheStoredRecord {
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
      metadata: {
        ...(generation === undefined ? {} : { terrainStreamingGeneration: generation }),
        ...(cacheWriteId === undefined ? {} : { cacheWriteId }),
      },
    },
    payload: new Uint8Array([createdAtUnixMs]).buffer,
  };
}

function request(
  cacheRecord: ClodCacheStoredRecord,
  streamingGeneration?: number,
  deadlineUnixMs = 100,
): Extract<CacheRpcRequest, { op: "put" }> {
  return {
    type: "cacheRpc",
    requestId: 1,
    op: "put",
    key: "stream-root",
    record: cacheRecord,
    deadlineUnixMs,
    ...(streamingGeneration === undefined ? {} : { streamingGeneration }),
  };
}

beforeEach(() => resetTerrainStreamingControlForTests());

describe("commitCachePut", () => {
  it("does not apply terrain-streaming state to unrelated cache writes", async () => {
    setTerrainStreamingEnabled(false);
    const put = vi.fn(async () => undefined);
    const store: CacheWriteStore = {
      put,
      deleteIfMatches: async () => false,
    };

    await expect(commitCachePut(store, request(record(undefined)), () => 0)).resolves.toBe(true);
    expect(put).toHaveBeenCalledOnce();
  });

  it("removes the exact streamed-root record when its generation changes during the write", async () => {
    let stored: ClodCacheStoredRecord | null = null;
    const remove = vi.fn(async (_key: string, expected: ClodCacheStoredRecord) => {
      if (!stored || !cacheRecordVersionMatches(stored, expected)) return false;
      stored = null;
      return true;
    });
    const store: CacheWriteStore = {
      put: async (_key, value) => {
        stored = value;
        setTerrainStreamingEnabled(false);
        setTerrainStreamingEnabled(true);
      },
      deleteIfMatches: remove,
    };

    await expect(commitCachePut(store, request(record(0), 0), () => 0)).resolves.toBe(false);
    expect(remove).toHaveBeenCalledWith("stream-root", expect.any(Object));
    expect(stored).toBeNull();
  });

  it("does not delete a newer replacement written under the resumed generation", async () => {
    let stored: ClodCacheStoredRecord | null = null;
    const newer = record(2, 2);
    const remove = vi.fn(async (_key: string, expected: ClodCacheStoredRecord) => {
      if (!stored || !cacheRecordVersionMatches(stored, expected)) return false;
      stored = null;
      return true;
    });
    const store: CacheWriteStore = {
      put: async () => {
        setTerrainStreamingEnabled(false);
        setTerrainStreamingEnabled(true);
        stored = newer;
      },
      deleteIfMatches: remove,
    };

    await expect(commitCachePut(store, request(record(0), 0), () => 0)).resolves.toBe(false);
    expect(remove).toHaveBeenCalledOnce();
    expect(stored).toBe(newer);
  });

  it("rejects a write whose broker deadline elapsed before execution", async () => {
    const put = vi.fn(async () => undefined);
    const store: CacheWriteStore = {
      put,
      deleteIfMatches: async () => false,
    };

    await expect(commitCachePut(store, request(record(undefined), undefined, 10), () => 11)).resolves.toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it("rolls back an exact write whose deadline expires during commit", async () => {
    let now = 0;
    let stored: ClodCacheStoredRecord | null = null;
    const remove = vi.fn(async (_key: string, expected: ClodCacheStoredRecord) => {
      if (!stored || !cacheRecordVersionMatches(stored, expected)) return false;
      stored = null;
      return true;
    });
    const store: CacheWriteStore = {
      put: async (_key, value) => {
        stored = value;
        now = 11;
      },
      deleteIfMatches: remove,
    };

    await expect(commitCachePut(store, request(record(undefined), undefined, 10), () => now)).resolves.toBe(false);
    expect(remove).toHaveBeenCalledOnce();
    expect(stored).toBeNull();
  });

  it("does not match same-millisecond replacements with different write ids", () => {
    const first = record(undefined, 1, "session:1");
    const replacement = record(undefined, 1, "session:2");

    expect(cacheRecordVersionMatches(first, replacement)).toBe(false);
  });
});
