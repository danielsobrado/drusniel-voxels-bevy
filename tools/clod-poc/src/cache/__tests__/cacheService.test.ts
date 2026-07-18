import { describe, expect, it } from "vitest";
import { parseClodCacheConfig } from "../cacheConfig.js";
import { createClodCacheService } from "../cacheService.js";
import { InMemoryPersistentStore } from "../indexedDbStore.js";
import {
  encodeClodPageNodeArtifact,
  decodeClodPageNodeArtifact,
  type ClodPageNodeArtifact,
} from "../artifactSerializer.js";
import { buildClodCacheKey } from "../cacheKey.js";
import type { ClodCacheKeyParts, ClodCacheStoredRecord } from "../cacheTypes.js";
import { CacheScheduler } from "../cacheScheduler.js";
import { CacheUnavailableError, CacheWriteRejectedError } from "../cacheErrors.js";
import { cacheRecordVersionMatches } from "../streaming_cache_write_guard.js";

const yaml = `
cache:
  enabled: true
  namespace: "test"
  schema_version: 1
  builder_version: "v1"
  strict: false
  memory:
    enabled: true
    max_items: 64
    max_bytes: 1048576
  persistent:
    enabled: true
    backend: "indexeddb"
    database_name: "test-db"
    object_store_name: "artifacts"
    max_items: 64
    max_bytes: 1048576
    compression: "none"
    checksum: "sha256"
    rpc_timeout_ms: 30000
  invalidation:
    include_config_hash: true
    include_generator_version: true
    include_builder_version: true
    include_world_seed: true
    include_source_revision: true
    include_source_hash: true
  streaming:
    read_budget_per_frame: 8
    write_budget_per_frame: 4
    max_decode_ms_per_frame: 16
    max_encode_ms_per_frame: 16
    keep_stale_until_replacement: true
  debug:
    log_cache_hits: false
    log_cache_misses: false
    log_cache_evictions: false
    expose_overlay_stats: false
`;

const keyParts: ClodCacheKeyParts = {
  namespace: "test",
  schemaVersion: 1,
  builderVersion: "v1",
  artifactKind: "clod-page-node",
  worldSeed: "0",
  generatorVersion: "g1",
  sourceRevision: "r1",
  configHash: "cfg1",
  sourceHash: "src1",
  pageX: 0,
  pageZ: 0,
  lod: 0,
  nodeId: "L0:0,0",
};

const secondKeyParts: ClodCacheKeyParts = {
  ...keyParts,
  pageX: 1,
  nodeId: "L0:1,0",
};

const artifact: ClodPageNodeArtifact = {
  nodeId: "L0:0,0",
  level: 0,
  positions: new Float32Array([0, 0, 0]),
  normals: new Float32Array([0, 1, 0]),
  paintSlots: new Float32Array([0]),
  materialWeights: new Float32Array([1, 0, 0, 0]),
  materialWeightStride: 4,
  indices: new Uint32Array([0, 0, 0]),
  errorWorld: 0,
  boundingSphere: [0, 0, 0, 1],
  lowBenefit: false,
  footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
  bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 1 },
};

class RejectingPersistentStore extends InMemoryPersistentStore {
  override async put(_key: string, _record: ClodCacheStoredRecord): Promise<void> {
    throw new CacheWriteRejectedError("stale generation");
  }
}

class ConditionalMemoryStore extends InMemoryPersistentStore {
  async deleteIfMatches(key: string, expected: ClodCacheStoredRecord): Promise<boolean> {
    const current = await this.get(key);
    if (!current || !cacheRecordVersionMatches(current, expected)) return false;
    await this.delete(key);
    return true;
  }
}

class FailingEvictionStore extends InMemoryPersistentStore {
  failDeletes = false;
  failOnceKeys = new Set<string>();

  override async delete(key: string): Promise<void> {
    if (this.failDeletes || this.failOnceKeys.has(key)) {
      this.failOnceKeys.delete(key);
      throw new CacheUnavailableError(`delete failed for ${key}`);
    }
    await super.delete(key);
  }
}

describe("cache service", () => {
  it("misses when disabled", async () => {
    const config = parseClodCacheConfig(yaml);
    config.enabled = false;
    const service = createClodCacheService(config, new InMemoryPersistentStore());
    const result = await service.get(keyParts, (b) => b);
    expect(result.status).toBe("miss");
    expect(result.reason).toBe("disabled");
  });

  it("misses when not found", async () => {
    const config = parseClodCacheConfig(yaml);
    const service = createClodCacheService(config, new InMemoryPersistentStore());
    const result = await service.get(keyParts, decodeClodPageNodeArtifact);
    expect(result.status).toBe("miss");
    expect(result.reason).toBe("not-found");
  });

  it("hits after put", async () => {
    const config = parseClodCacheConfig(yaml);
    const service = createClodCacheService(config, new InMemoryPersistentStore());
    await service.put(keyParts, artifact, encodeClodPageNodeArtifact, {});
    await service.flush();
    const result = await service.get(keyParts, decodeClodPageNodeArtifact);
    expect(result.status).toBe("hit");
    expect(result.artifact?.nodeId).toBe("L0:0,0");
    expect(result.bytesRead).toBeGreaterThan(0);
  });

  it("does not publish a commit-gated write rejected by persistence", async () => {
    const config = parseClodCacheConfig(yaml);
    const service = createClodCacheService(config, new RejectingPersistentStore());

    const put = await service.put(keyParts, artifact, encodeClodPageNodeArtifact, {
      terrainStreamingGeneration: 0,
      terrainStreamingWriteId: "0:1",
    });
    const result = await service.get(keyParts, decodeClodPageNodeArtifact);

    expect(put.bytesWritten).toBe(0);
    expect(result.status).toBe("miss");
    expect(result.reason).toBe("not-found");
  });

  it("removes stale memory without deleting a newer persistent replacement", async () => {
    const config = parseClodCacheConfig(yaml);
    const store = new ConditionalMemoryStore();
    const service = createClodCacheService(config, store);
    const metadata = {
      terrainStreamingGeneration: 0,
      terrainStreamingWriteId: "0:1",
    };

    await service.put(keyParts, artifact, encodeClodPageNodeArtifact, metadata);
    const key = buildClodCacheKey(keyParts);
    const original = (await store.get(key))!;
    const replacement: ClodCacheStoredRecord = {
      ...original,
      header: {
        ...original.header,
        createdAtUnixMs: original.header.createdAtUnixMs + 1,
        metadata: {
          terrainStreamingGeneration: 2,
          terrainStreamingWriteId: "2:1",
        },
      },
    };
    await store.put(key, replacement);

    await expect(service.deleteIfMatches(keyParts, metadata)).resolves.toBe(true);
    const result = await service.get(keyParts, decodeClodPageNodeArtifact);

    expect(result.status).toBe("hit");
    expect(result.metadata?.terrainStreamingGeneration).toBe(2);
    expect(result.metadata?.terrainStreamingWriteId).toBe("2:1");
    expect(service.getMetrics().persistentEntries).toBe(1);
  });

  it("keeps a committed write successful when eviction housekeeping fails", async () => {
    const config = parseClodCacheConfig(yaml);
    config.persistent.max_items = 1;
    const store = new FailingEvictionStore();
    const service = createClodCacheService(config, store);

    await service.put(keyParts, artifact, encodeClodPageNodeArtifact, {});
    store.failDeletes = true;
    const committed = await service.put(secondKeyParts, artifact, encodeClodPageNodeArtifact, {});
    const result = await service.get(secondKeyParts, decodeClodPageNodeArtifact);

    expect(committed.bytesWritten).toBeGreaterThan(0);
    expect(result.status).toBe("hit");
    expect(service.getMetrics().persistentEntries).toBe(2);
  });

  it("continues eviction after a single-key delete failure", async () => {
    const config = parseClodCacheConfig(yaml);
    config.persistent.max_items = 2;
    const store = new FailingEvictionStore();
    const service = createClodCacheService(config, store);
    const thirdKeyParts = { ...keyParts, pageX: 2, nodeId: "L0:2,0" };
    const firstKey = buildClodCacheKey(keyParts);
    const secondKey = buildClodCacheKey(secondKeyParts);
    const thirdKey = buildClodCacheKey(thirdKeyParts);

    await service.put(keyParts, artifact, encodeClodPageNodeArtifact, {});
    await service.put(secondKeyParts, artifact, encodeClodPageNodeArtifact, {});
    // LRU-oldest (first) fails once; eviction must skip it and remove the next candidate.
    store.failOnceKeys.add(firstKey);
    await service.put(thirdKeyParts, artifact, encodeClodPageNodeArtifact, {});

    expect(await store.get(firstKey)).not.toBeNull();
    expect(await store.get(secondKey)).toBeNull();
    expect(await store.get(thirdKey)).not.toBeNull();
    expect(service.getMetrics().persistentEntries).toBe(2);
  });

  it("checksum mismatch becomes miss", async () => {
    const config = parseClodCacheConfig(yaml);
    config.memory.enabled = false;
    const store = new InMemoryPersistentStore();
    const service = createClodCacheService(config, store);
    await service.put(keyParts, artifact, encodeClodPageNodeArtifact, {});
    await service.flush();
    const key = buildClodCacheKey(keyParts);
    const stored = (await store.get(key))!;
    await store.put(key, {
      ...stored,
      header: { ...stored.header, checksum: "00".repeat(32) },
    });
    const result = await service.get(keyParts, decodeClodPageNodeArtifact);
    expect(result.status).toBe("miss");
    expect(result.reason).toBe("checksum-mismatch");
  });

  it("source revision mismatch becomes miss", async () => {
    const config = parseClodCacheConfig(yaml);
    config.memory.enabled = false;
    const store = new InMemoryPersistentStore();
    const service = createClodCacheService(config, store);
    await service.put(keyParts, artifact, encodeClodPageNodeArtifact, {});
    await service.flush();
    const key = buildClodCacheKey(keyParts);
    const stored = (await store.get(key))!;
    await store.put(key, {
      ...stored,
      header: { ...stored.header, sourceRevision: "stale-revision" },
    });
    const result = await service.get(keyParts, decodeClodPageNodeArtifact);
    expect(result.status).toBe("miss");
    expect(result.reason).toBe("source-revision-mismatch");
  });

  it("decode error becomes miss", async () => {
    const config = parseClodCacheConfig(yaml);
    const service = createClodCacheService(config, new InMemoryPersistentStore());
    await service.put(keyParts, artifact, encodeClodPageNodeArtifact, {});
    await service.flush();
    const result = await service.get(keyParts, () => {
      throw new Error("bad decode");
    });
    expect(result.status).toBe("miss");
    expect(result.reason).toBe("decode-error");
  });
});

describe("cache scheduler", () => {
  it("respects read/write budget counts", async () => {
    const scheduler = new CacheScheduler({
      read_budget_per_frame: 2,
      write_budget_per_frame: 1,
      max_decode_ms_per_frame: 100,
      max_encode_ms_per_frame: 100,
      keep_stale_until_replacement: true,
    });
    let reads = 0;
    let writes = 0;
    const readPromises = Array.from({ length: 5 }, () =>
      scheduler.scheduleRead(async () => {
        reads++;
        return reads;
      }),
    );
    const writePromises = Array.from({ length: 3 }, () =>
      scheduler.scheduleWrite(async () => {
        writes++;
      }),
    );
    await scheduler.flush();
    await Promise.all([...readPromises, ...writePromises]);
    expect(reads).toBe(5);
    expect(writes).toBe(3);
  });
});
