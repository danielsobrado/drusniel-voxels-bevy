import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { ClodCacheStoredRecord } from "../cacheTypes.js";
import {
  createPersistentStore,
  IndexedDbStore,
  resolveBrokerPersistentConfig,
  resolvePersistentConfig,
} from "../indexedDbStore.js";
import { WorkerRemotePersistentStore } from "../workerRemotePersistentStore.js";

const base = {
  enabled: true,
  backend: "indexeddb" as const,
  database_name: "drusniel-clod-poc-cache",
  object_store_name: "artifacts",
  max_items: 100,
  max_bytes: 1_000_000,
  compression: "none" as const,
  checksum: "sha256" as const,
};

describe("persistent config roles", () => {
  it("uses a separate main-thread summary database", () => {
    const resolved = resolvePersistentConfig(base, "main");
    expect(resolved.enabled).toBe(true);
    expect(resolved.database_name).toBe("drusniel-clod-poc-cache-summary-v2");
    expect(resolved.object_store_name).toBe("artifacts");
  });

  it("disables local worker IndexedDB (brokered on main thread)", () => {
    const resolved = resolvePersistentConfig(base, "worker");
    expect(resolved.enabled).toBe(false);
  });

  it("uses broker database name on main thread", () => {
    const resolved = resolveBrokerPersistentConfig(base);
    expect(resolved.enabled).toBe(true);
    expect(resolved.database_name).toBe("drusniel-clod-poc-cache-pages-v2");
    expect(resolved.object_store_name).toBe("artifacts");
  });

  it("createPersistentStore worker role does not throw on persistent config shape", () => {
    expect(() => createPersistentStore(base, "worker")).not.toThrow();
    const store = createPersistentStore(base, "worker");
    expect(store).toBeInstanceOf(WorkerRemotePersistentStore);
  });
});

describe("IndexedDbStore conditional delete", () => {
  beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
  afterEach(() => vi.unstubAllGlobals());

  it("deletes only the exact record version in one transaction", async () => {
    const store = new IndexedDbStore({
      ...base,
      database_name: "conditional-delete-test",
    });
    const original = cacheRecord(1);
    const replacement = cacheRecord(2);

    await store.put("stream-root", original);
    await expect(store.deleteIfMatches("stream-root", replacement)).resolves.toBe(false);
    await expect(store.get("stream-root")).resolves.toEqual(original);

    await expect(store.deleteIfMatches("stream-root", original)).resolves.toBe(true);
    await expect(store.get("stream-root")).resolves.toBeNull();
  });
});

function cacheRecord(version: number): ClodCacheStoredRecord {
  return {
    header: {
      schemaVersion: 1,
      artifactKind: "clod-stream-root-node",
      key: "stream-root",
      createdAtUnixMs: version,
      builderVersion: "test",
      generatorVersion: "test",
      worldSeed: "test",
      sourceRevision: "0",
      configHash: "test",
      sourceHash: "test",
      uncompressedBytes: 1,
      storedBytes: 1,
      compression: "none",
      checksum: `checksum-${version}`,
      metadata: { terrainStreamingGeneration: version },
    },
    payload: new Uint8Array([version]).buffer,
  };
}
