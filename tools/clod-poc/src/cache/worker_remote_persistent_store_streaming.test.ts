import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import type { CacheRpcRequest } from "./cacheWorkerRpc.js";
import { CacheUnavailableError, CacheWriteRejectedError } from "./cacheErrors.js";
import {
  clearTimedOutCachePutsForTests,
  dispatchCacheRpcResponse,
  pendingCacheRpcCount,
  timedOutCachePutCount,
  WorkerRemotePersistentStore,
} from "./workerRemotePersistentStore.js";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../stream/terrain_streaming_control.js";

const postMessage = vi.fn();

function cacheRecord(streamingGeneration?: number, payloadBytes = 1): ClodCacheStoredRecord {
  return {
    header: {
      schemaVersion: 1,
      artifactKind: "clod-stream-root-node",
      key: "stream-root",
      createdAtUnixMs: 0,
      builderVersion: "test",
      generatorVersion: "test",
      worldSeed: "test",
      sourceRevision: "0",
      configHash: "test",
      sourceHash: "test",
      uncompressedBytes: payloadBytes,
      storedBytes: payloadBytes,
      compression: "none",
      checksum: "test",
      metadata: streamingGeneration === undefined
        ? {}
        : { terrainStreamingGeneration: streamingGeneration },
    },
    payload: new Uint8Array(payloadBytes).buffer,
  };
}

beforeEach(() => {
  postMessage.mockReset();
  clearTimedOutCachePutsForTests();
  resetTerrainStreamingControlForTests();
  vi.stubGlobal("self", { postMessage });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearTimedOutCachePutsForTests();
});

describe("WorkerRemotePersistentStore streaming generation", () => {
  it("reports a stale streamed-root write rejection to the cache service", async () => {
    const store = new WorkerRemotePersistentStore();
    setTerrainStreamingEnabled(false);
    setTerrainStreamingEnabled(true);

    const pending = store.put("stream-root", cacheRecord(0));
    const request = postMessage.mock.calls[0]![0] as Extract<CacheRpcRequest, { op: "put" }>;

    expect(request.streamingGeneration).toBe(0);
    dispatchCacheRpcResponse({ type: "cacheRpc", requestId: request.requestId, ok: true, result: false });
    await expect(pending).rejects.toBeInstanceOf(CacheWriteRejectedError);
  });

  it("does not stamp unrelated cache records with the current streaming generation", async () => {
    const store = new WorkerRemotePersistentStore();
    setTerrainStreamingEnabled(false);

    const pending = store.put("generic", cacheRecord());
    const request = postMessage.mock.calls[0]![0] as Extract<CacheRpcRequest, { op: "put" }>;

    expect(request).not.toHaveProperty("streamingGeneration");
    dispatchCacheRpcResponse({ type: "cacheRpc", requestId: request.requestId, ok: true, result: true });
    await pending;
  });

  it("forwards conditional deletes to the main-thread broker", async () => {
    const store = new WorkerRemotePersistentStore();
    const record = cacheRecord(0);

    const pending = store.deleteIfMatches("stream-root", record);
    const request = postMessage.mock.calls[0]![0] as Extract<CacheRpcRequest, { op: "deleteIfMatches" }>;

    expect(request.key).toBe("stream-root");
    expect(request.record.header.metadata.terrainStreamingGeneration).toBe(0);
    dispatchCacheRpcResponse({ type: "cacheRpc", requestId: request.requestId, ok: true, result: true });
    await expect(pending).resolves.toBe(true);
  });

  it("times out an unanswered RPC and removes its pending entry", async () => {
    vi.useFakeTimers();
    const store = new WorkerRemotePersistentStore(25);

    const result = store.get("missing");
    const rejection = expect(result).rejects.toBeInstanceOf(CacheUnavailableError);
    expect(pendingCacheRpcCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(pendingCacheRpcCount()).toBe(0);
  });

  it("compensates a late successful put without retaining its payload", async () => {
    vi.useFakeTimers();
    const store = new WorkerRemotePersistentStore(25);
    const record = cacheRecord(0, 4 * 1024 * 1024);

    const pending = store.put("stream-root", record);
    const putRequest = postMessage.mock.calls[0]![0] as Extract<CacheRpcRequest, { op: "put" }>;
    const rejection = expect(pending).rejects.toBeInstanceOf(CacheUnavailableError);
    expect(putRequest.record.payload.byteLength).toBe(record.payload.byteLength);

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(pendingCacheRpcCount()).toBe(0);
    expect(timedOutCachePutCount()).toBe(1);

    postMessage.mockClear();
    expect(dispatchCacheRpcResponse({
      type: "cacheRpc",
      requestId: putRequest.requestId,
      ok: true,
      result: true,
    })).toBe(false);
    expect(timedOutCachePutCount()).toBe(0);

    const compensate = postMessage.mock.calls[0]![0] as Extract<CacheRpcRequest, { op: "deleteIfMatches" }>;
    expect(compensate.op).toBe("deleteIfMatches");
    expect(compensate.key).toBe("stream-root");
    expect(compensate.record.payload.byteLength).toBe(0);
    expect(compensate.record.header).toEqual(record.header);
    dispatchCacheRpcResponse({
      type: "cacheRpc",
      requestId: compensate.requestId,
      ok: true,
      result: true,
    });
  });

  it("removes the pending entry when postMessage throws", async () => {
    postMessage.mockImplementationOnce(() => {
      throw new Error("worker stopped");
    });
    const store = new WorkerRemotePersistentStore(25);

    await expect(store.get("missing")).rejects.toThrow("worker stopped");
    expect(pendingCacheRpcCount()).toBe(0);
  });
});
