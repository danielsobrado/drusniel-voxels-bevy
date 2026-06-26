import { describe, expect, it } from "vitest";
import { MemoryCache } from "../memoryCache.js";
import type { ClodCacheStoredRecord } from "../cacheTypes.js";

function record(key: string, bytes: number): ClodCacheStoredRecord {
  const payload = new ArrayBuffer(bytes);
  return {
    header: {
      schemaVersion: 1,
      artifactKind: "clod-page-node",
      key,
      createdAtUnixMs: Date.now(),
      builderVersion: "v1",
      generatorVersion: "g1",
      worldSeed: "0",
      sourceRevision: "r1",
      configHash: "c1",
      sourceHash: "s1",
      uncompressedBytes: bytes,
      storedBytes: bytes,
      compression: "none",
      checksum: "abc",
      metadata: {},
    },
    payload,
  };
}

describe("memory cache", () => {
  it("hits after put", () => {
    const cache = new MemoryCache(8, 1024);
    cache.put("a", record("a", 16));
    expect(cache.get("a")?.header.key).toBe("a");
    expect(cache.get("missing")).toBeNull();
  });

  it("evicts LRU by item count", () => {
    const cache = new MemoryCache(2, 10_000);
    cache.put("a", record("a", 10));
    cache.put("b", record("b", 10));
    cache.get("a");
    const evicted = cache.put("c", record("c", 10));
    expect(evicted.length).toBeGreaterThan(0);
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).not.toBeNull();
    expect(cache.get("c")).not.toBeNull();
  });

  it("evicts LRU by bytes", () => {
    const cache = new MemoryCache(100, 30);
    cache.put("a", record("a", 20));
    const evicted = cache.put("b", record("b", 20));
    expect(evicted.length).toBeGreaterThan(0);
    expect(cache.bytes).toBeLessThanOrEqual(30);
  });
});
