import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import { attachMainThreadCacheBroker } from "./mainThreadCacheBroker.js";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../stream/terrain_streaming_control.js";

function cacheRecord(): ClodCacheStoredRecord {
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
      metadata: {},
    },
    payload: new Uint8Array([1]).buffer,
  };
}

beforeEach(() => resetTerrainStreamingControlForTests());

describe("main-thread cache broker streaming gate", () => {
  it("initializes the worker state and drops stale persistent writes after resume", async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const postMessage = vi.fn();
    const worker = {
      addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.push(listener),
      postMessage,
    };

    attachMainThreadCacheBroker(worker);
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "terrainStreamingState",
      enabled: true,
      generation: 0,
    });

    setTerrainStreamingEnabled(false);
    setTerrainStreamingEnabled(true);
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "terrainStreamingState",
      enabled: true,
      generation: 2,
    });

    listeners[0]!({
      data: {
        type: "cacheRpc",
        requestId: 77,
        op: "put",
        key: "stream-root",
        record: cacheRecord(),
        deadlineUnixMs: Date.now() + 1_000,
        streamingGeneration: 0,
      },
    } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessage).toHaveBeenLastCalledWith({
      type: "cacheRpc",
      requestId: 77,
      ok: true,
      result: false,
    });
  });
});
