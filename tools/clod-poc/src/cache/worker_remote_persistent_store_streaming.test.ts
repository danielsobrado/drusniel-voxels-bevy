import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import type { CacheRpcRequest } from "./cacheWorkerRpc.js";
import { CacheWriteRejectedError } from "./cacheErrors.js";
import {
  dispatchCacheRpcResponse,
  WorkerRemotePersistentStore,
} from "./workerRemotePersistentStore.js";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../stream/terrain_streaming_control.js";

const postMessage = vi.fn();

function cacheRecord(streamingGeneration?: number): ClodCacheStoredRecord {
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
      uncompressedBytes: 1,
      storedBytes: 1,
      compression: "none",
      checksum: "test",
      metadata: streamingGeneration === undefined
        ? {}
        : { terrainStreamingGeneration: streamingGeneration },
    },
    payload: new Uint8Array([1]).buffer,
  };
}

beforeEach(() => {
  postMessage.mockReset();
  resetTerrainStreamingControlForTests();
  vi.stubGlobal("self", { postMessage });
});

afterEach(() => vi.unstubAllGlobals());

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
});
