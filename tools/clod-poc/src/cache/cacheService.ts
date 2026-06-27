import type { ClodCacheConfig } from "./cacheConfig.js";
import { isCacheEffective as cacheEffective } from "./cacheConfig.js";
import { buildClodCacheKey } from "./cacheKey.js";
import type {
  ClodCacheGetResult,
  ClodCacheKeyParts,
  ClodCachePutResult,
  ClodCacheStoredRecord,
  CacheMissReason,
} from "./cacheTypes.js";
import { MemoryCache } from "./memoryCache.js";
import { ClodCacheManifest } from "./cacheManifest.js";
import { CacheMetricsTracker, type ClodCacheMetrics } from "./cacheMetrics.js";
import { CacheScheduler } from "./cacheScheduler.js";
import { compressPayload, decompressPayload, resolveCompressionMode } from "./compression.js";
import { sha256Hex } from "./checksum.js";
import {
  CacheChecksumError,
  CacheCorruptError,
  CacheDecodeError,
  CacheUnavailableError,
} from "./cacheErrors.js";
import { cacheLogger } from "./cacheLogger.js";
import { createPersistentStore, type PersistentCacheStore, type CachePersistenceRole } from "./indexedDbStore.js";

export interface ClodCacheService {
  get<TArtifact>(
    keyParts: ClodCacheKeyParts,
    decode: (payload: ArrayBuffer) => TArtifact,
  ): Promise<ClodCacheGetResult<TArtifact>>;

  put<TArtifact>(
    keyParts: ClodCacheKeyParts,
    artifact: TArtifact,
    encode: (artifact: TArtifact) => ArrayBuffer,
    metadata: Record<string, string | number | boolean>,
  ): Promise<ClodCachePutResult>;

  delete(keyParts: ClodCacheKeyParts): Promise<void>;
  clear(): Promise<void>;
  clearMemory(): void;
  clearPersistent(): Promise<void>;
  flush(): Promise<void>;
  initialize(): Promise<void>;
  getMetrics(): ClodCacheMetrics;
  getConfig(): ClodCacheConfig;
}

function miss<T>(key: string, reason: CacheMissReason, decodeMs = 0): ClodCacheGetResult<T> {
  return { status: "miss", reason, key, bytesRead: 0, decodeMs };
}

function isArtifactValidationError(error: unknown): boolean {
  return error instanceof CacheCorruptError
    || error instanceof CacheDecodeError
    || error instanceof CacheChecksumError;
}

export class ClodCacheServiceImpl implements ClodCacheService {
  private readonly config: ClodCacheConfig;
  private readonly memory: MemoryCache | null;
  private persistent: PersistentCacheStore | null;
  private readonly manifest: ClodCacheManifest;
  private readonly scheduler: CacheScheduler;
  private readonly metrics: CacheMetricsTracker;
  private manifestLoaded = false;
  private persistentErrorCount = 0;
  private readonly PERSISTENT_ERROR_THRESHOLD = 3;

  constructor(
    config: ClodCacheConfig,
    persistentOverride?: PersistentCacheStore | null,
    role: CachePersistenceRole = "worker",
  ) {
    this.config = config;
    this.memory = config.memory.enabled
      ? new MemoryCache(config.memory.max_items, config.memory.max_bytes)
      : null;
    this.persistent = persistentOverride !== undefined
      ? persistentOverride
      : createPersistentStore(config.persistent, role);
    this.manifest = new ClodCacheManifest();
    this.scheduler = new CacheScheduler(config.streaming);
    this.metrics = new CacheMetricsTracker(cacheEffective(config));
  }

  private notePersistentError(): void {
    this.persistentErrorCount++;
    if (this.persistentErrorCount >= this.PERSISTENT_ERROR_THRESHOLD && this.persistent) {
      cacheLogger.error(`persistent store failed ${this.persistentErrorCount} times, disabling persistence for this session`);
      this.persistent = null;
      this.metrics.recordError("persistence-disabled");
    }
  }

  getConfig(): ClodCacheConfig {
    return this.config;
  }

  getMetrics(): ClodCacheMetrics {
    this.metrics.setPending(this.scheduler.pendingReads, this.scheduler.pendingWrites);
    this.metrics.setEntryCounts(this.memory?.size ?? 0, this.manifest.size);
    return { ...this.metrics.metrics };
  }

  async initialize(): Promise<void> {
    if (this.manifestLoaded || !this.persistent) return;
    this.manifestLoaded = true;

    const probeOk = await this.persistent.probe();
    if (!probeOk) {
      cacheLogger.warn("IndexedDB probe failed, using memory-only cache for this session");
      this.persistent = null;
      return;
    }

    try {
      await this.hydrateManifestFromArtifacts();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : String(error);
      cacheLogger.debug(`manifest hydrate skipped [${name}] ${message}`);
    }
  }

  private async hydrateManifestFromArtifacts(): Promise<void> {
    if (!this.persistent) return;
    const keys = await this.persistent.keys();
    const maxScan = Math.min(keys.length, 256);
    for (let i = 0; i < maxScan; i++) {
      const key = keys[i]!;
      const record = await this.persistent.get(key);
      if (!record) continue;
      this.manifest.upsert({
        key,
        artifactKind: record.header.artifactKind,
        createdAtUnixMs: record.header.createdAtUnixMs,
        lastAccessedUnixMs: record.header.createdAtUnixMs,
        hitCount: 0,
        storedBytes: record.header.storedBytes,
      });
    }
    if (keys.length > maxScan) {
      cacheLogger.debug(`manifest hydrate scanned ${maxScan}/${keys.length} artifact keys`);
    }
  }

  private scheduleManifestPersist(): void {
    // Manifest eviction state is memory-only for IndexedDB backends.
  }

  async get<TArtifact>(
    keyParts: ClodCacheKeyParts,
    decode: (payload: ArrayBuffer) => TArtifact,
  ): Promise<ClodCacheGetResult<TArtifact>> {
    const key = buildClodCacheKey(keyParts);
    if (!cacheEffective(this.config)) {
      this.metrics.recordMiss("disabled");
      return miss(key, "disabled");
    }

    return this.scheduler.scheduleRead(async () => {
      const t0 = performance.now();
      try {
        const record = await this.loadRecord(key);
        if (!record) {
          this.logMiss(key, "not-found");
          this.metrics.recordMiss("not-found");
          return miss<TArtifact>(key, "not-found", performance.now() - t0);
        }

        const validationReason = this.validateHeader(record.header, keyParts);
        if (validationReason) {
          this.logMiss(key, validationReason);
          this.metrics.recordMiss(validationReason);
          void this.delete(keyParts);
          return miss<TArtifact>(key, validationReason, performance.now() - t0);
        }

        const uncompressed = await decompressPayload(record.payload, record.header.compression);
        const checksum = await sha256Hex(uncompressed);
        if (checksum !== record.header.checksum) {
          cacheLogger.warn(`checksum mismatch for ${key}`);
          this.metrics.recordMiss("checksum-mismatch");
          void this.delete(keyParts);
          return miss<TArtifact>(key, "checksum-mismatch", performance.now() - t0);
        }

        const artifact = decode(uncompressed);
        const decodeMs = performance.now() - t0;
        this.metrics.recordHit(record.header.storedBytes, decodeMs);
        if (this.config.debug.log_cache_hits) cacheLogger.debug(`hit ${key} (${record.header.storedBytes} B, ${decodeMs.toFixed(2)} ms)`);
        void this.touchManifest(key, record.header.artifactKind, record.header.storedBytes);
        return {
          status: "hit",
          artifact,
          key,
          bytesRead: record.header.storedBytes,
          decodeMs,
          metadata: record.header.metadata,
        };
      } catch (error) {
        const reason: CacheMissReason =
          error instanceof CacheChecksumError
            ? "checksum-mismatch"
            : error instanceof CacheUnavailableError
              ? "backend-error"
              : "decode-error";
        const name = error instanceof Error ? error.name : "";
        const message = error instanceof Error ? error.message : String(error);
        cacheLogger.warn(`get failed for ${key} [${name}] ${message}`);
        this.metrics.recordMiss(reason);
        this.metrics.recordError(`[${name}] ${message}`);
        if (isArtifactValidationError(error)) {
          void this.delete(keyParts);
        }
        if (reason === "backend-error") this.notePersistentError();
        if (this.config.strict) throw error;
        return miss<TArtifact>(key, reason, performance.now() - t0);
      }
    });
  }

  async put<TArtifact>(
    keyParts: ClodCacheKeyParts,
    artifact: TArtifact,
    encode: (artifact: TArtifact) => ArrayBuffer,
    metadata: Record<string, string | number | boolean>,
  ): Promise<ClodCachePutResult> {
    const key = buildClodCacheKey(keyParts);
    if (!cacheEffective(this.config)) {
      return { key, bytesWritten: 0, encodeMs: 0, compression: "none" };
    }

    return this.scheduler.scheduleWrite(async () => {
      const t0 = performance.now();
      try {
        const uncompressed = encode(artifact);
        const checksum = await sha256Hex(uncompressed);
        const compressionMode = resolveCompressionMode(this.config.persistent.compression);
        const compressed = await compressPayload(uncompressed, compressionMode);
        const now = Date.now();
        const header = {
          schemaVersion: this.config.schema_version,
          artifactKind: keyParts.artifactKind,
          key,
          createdAtUnixMs: now,
          builderVersion: keyParts.builderVersion,
          generatorVersion: keyParts.generatorVersion,
          worldSeed: keyParts.worldSeed,
          sourceRevision: keyParts.sourceRevision,
          configHash: keyParts.configHash,
          sourceHash: keyParts.sourceHash,
          uncompressedBytes: uncompressed.byteLength,
          storedBytes: compressed.bytes.byteLength,
          compression: compressed.mode,
          checksum,
          metadata,
        };
        const record: ClodCacheStoredRecord = { header, payload: compressed.bytes };
        if (this.memory) {
          const evicted = this.memory.put(key, record);
          if (evicted.length > 0) this.onEvicted(evicted);
        }
        if (this.persistent) {
          await this.persistent.put(key, record);
          this.manifest.upsert({
            key,
            artifactKind: keyParts.artifactKind,
            createdAtUnixMs: now,
            lastAccessedUnixMs: now,
            hitCount: 0,
            storedBytes: record.header.storedBytes,
          });
          const evictedKeys = this.manifest.evictOldest(
            this.config.persistent.max_items,
            this.config.persistent.max_bytes,
          );
          for (const evictKey of evictedKeys) {
            await this.persistent.delete(evictKey);
            this.manifest.delete(evictKey);
            this.onEvicted([evictKey]);
          }
          this.scheduleManifestPersist();
        }
        const encodeMs = performance.now() - t0;
        this.metrics.recordWrite(record.header.storedBytes, encodeMs);
        return { key, bytesWritten: record.header.storedBytes, encodeMs, compression: compressed.mode };
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        const message = error instanceof Error ? error.message : String(error);
        cacheLogger.error(`put failed for ${key} [${name}] ${message}`);
        this.metrics.recordError(`[${name}] ${message}`);
        if (error instanceof CacheUnavailableError || error instanceof DOMException) {
          this.notePersistentError();
        }
        if (this.config.strict) throw error;
        return { key, bytesWritten: 0, encodeMs: performance.now() - t0, compression: "none" };
      }
    });
  }

  async delete(keyParts: ClodCacheKeyParts): Promise<void> {
    const key = buildClodCacheKey(keyParts);
    this.memory?.delete(key);
    this.manifest.delete(key);
    if (this.persistent) await this.persistent.delete(key);
  }

  async clear(): Promise<void> {
    this.clearMemory();
    await this.clearPersistent();
  }

  clearMemory(): void {
    this.memory?.clear();
  }

  async clearPersistent(): Promise<void> {
    this.manifest.clear();
    if (this.persistent) {
      await this.persistent.clear();
      await this.persistent.putManifestEntries([]);
    }
  }

  async flush(): Promise<void> {
    await this.scheduler.flush();
  }

  private async loadRecord(key: string): Promise<ClodCacheStoredRecord | null> {
    const fromMemory = this.memory?.get(key) ?? null;
    if (fromMemory) return fromMemory;
    if (!this.persistent) return null;
    try {
      const record = await this.persistent.get(key);
      if (record && this.memory) this.memory.put(key, record);
      return record;
    } catch (error) {
      if (error instanceof CacheUnavailableError) return null;
      throw error;
    }
  }

  private validateHeader(
    header: ClodCacheStoredRecord["header"],
    keyParts: ClodCacheKeyParts,
  ): CacheMissReason | null {
    if (header.schemaVersion !== this.config.schema_version) return "schema-mismatch";
    if (header.artifactKind !== keyParts.artifactKind) return "schema-mismatch";
    if (this.config.invalidation.include_builder_version && header.builderVersion !== keyParts.builderVersion) {
      return "builder-version-mismatch";
    }
    if (this.config.invalidation.include_generator_version && header.generatorVersion !== keyParts.generatorVersion) {
      return "generator-version-mismatch";
    }
    if (this.config.invalidation.include_world_seed && header.worldSeed !== keyParts.worldSeed) {
      return "world-seed-mismatch";
    }
    if (this.config.invalidation.include_source_revision && header.sourceRevision !== keyParts.sourceRevision) {
      return "source-revision-mismatch";
    }
    if (this.config.invalidation.include_config_hash && header.configHash !== keyParts.configHash) {
      return "config-hash-mismatch";
    }
    if (this.config.invalidation.include_source_hash && header.sourceHash !== keyParts.sourceHash) {
      return "source-hash-mismatch";
    }
    return null;
  }

  private logMiss(key: string, reason: CacheMissReason): void {
    if (this.config.debug.log_cache_misses) cacheLogger.debug(`miss ${key} (${reason})`);
  }

  private onEvicted(keys: string[]): void {
    if (keys.length === 0) return;
    this.metrics.recordEviction(keys.length);
    if (this.config.debug.log_cache_evictions) {
      cacheLogger.info(`evicted ${keys.length} entries`);
    }
  }

  private touchManifest(key: string, artifactKind: ClodCacheStoredRecord["header"]["artifactKind"], storedBytes: number): void {
    const now = Date.now();
    const existing = this.manifest.getEntry(key);
    if (existing) {
      this.manifest.touchHit(key, now);
    } else {
      this.manifest.upsert({
        key,
        artifactKind,
        createdAtUnixMs: now,
        lastAccessedUnixMs: now,
        hitCount: 1,
        storedBytes,
      });
    }
    this.scheduleManifestPersist();
  }
}

export function createClodCacheService(
  config: ClodCacheConfig,
  persistentOverride?: PersistentCacheStore | null,
  role: CachePersistenceRole = "worker",
): ClodCacheService {
  return new ClodCacheServiceImpl(config, persistentOverride, role);
}
