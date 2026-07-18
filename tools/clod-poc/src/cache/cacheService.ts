import type { ClodCacheConfig } from "./cacheConfig.js";
import { isCacheEffective as cacheEffective } from "./cacheConfig.js";
import { buildClodCacheKey } from "./cacheKey.js";
import type {
  CacheMissReason,
  ClodCacheGetResult,
  ClodCacheKeyParts,
  ClodCacheManifestEntry,
  ClodCachePutResult,
  ClodCacheStoredRecord,
} from "./cacheTypes.js";
import { MemoryCache } from "./memoryCache.js";
import { ClodCacheManifest } from "./cacheManifest.js";
import { CacheMetricsTracker, type ClodCacheMetrics } from "./cacheMetrics.js";
import { CacheScheduler } from "./cacheScheduler.js";
import { compressPayload, decompressPayload, resolveCompressionMode } from "./compression.js";
import { sha256Hex } from "./checksum.js";
import {
  CacheChecksumError,
  CacheUnavailableError,
  CacheWriteRejectedError,
} from "./cacheErrors.js";
import { cacheLogger } from "./cacheLogger.js";
import {
  createPersistentStore,
  type CachePersistenceRole,
  type PersistentCacheStore,
} from "./indexedDbStore.js";
import type { ClodCacheService } from "./cache_service_types.js";
import {
  isArtifactValidationError,
  loadCachedRecord,
  miss,
  touchCacheManifest,
  validateCacheHeader,
} from "./cache_service_helpers.js";
import { cacheRecordVersionMatches } from "./streaming_cache_write_guard.js";
import { nextCacheWriteId } from "./cacheWriteIdentity.js";

export type { ClodCacheService } from "./cache_service_types.js";

function metadataMatches(
  actual: Readonly<Record<string, string | number | boolean>>,
  expected: Readonly<Record<string, string | number | boolean>>,
): boolean {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function writeRequiresCommitAcceptance(
  metadata: Readonly<Record<string, string | number | boolean>>,
): boolean {
  const generation = metadata.terrainStreamingGeneration;
  return typeof generation === "number" && Number.isInteger(generation) && generation >= 0;
}

function manifestEntryFromRecord(
  key: string,
  record: ClodCacheStoredRecord,
  lastAccessedUnixMs = record.header.createdAtUnixMs,
): ClodCacheManifestEntry {
  return {
    key,
    artifactKind: record.header.artifactKind,
    createdAtUnixMs: record.header.createdAtUnixMs,
    lastAccessedUnixMs,
    hitCount: 0,
    storedBytes: record.header.storedBytes,
  };
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
    this.memory = config.memory.enabled ? new MemoryCache(config.memory.max_items, config.memory.max_bytes) : null;
    this.persistent = persistentOverride !== undefined ? persistentOverride : createPersistentStore(config.persistent, role);
    this.manifest = new ClodCacheManifest();
    this.scheduler = new CacheScheduler(config.streaming);
    this.metrics = new CacheMetricsTracker(cacheEffective(config));
  }

  private notePersistentError(): void {
    this.persistentErrorCount++;
    if (this.persistentErrorCount >= this.PERSISTENT_ERROR_THRESHOLD && this.persistent) {
      cacheLogger.error(`persistent store failed ${this.persistentErrorCount} times, disabling persistence`);
      this.persistent = null;
      this.metrics.recordError("persistence-disabled");
    }
  }

  private storeInMemory(key: string, record: ClodCacheStoredRecord): void {
    if (!this.memory) return;
    const evicted = this.memory.put(key, record);
    if (evicted.length > 0) this.onEvicted(evicted);
  }

  private async recordPersistentWrite(
    persistent: PersistentCacheStore,
    key: string,
    record: ClodCacheStoredRecord,
    now: number,
  ): Promise<void> {
    this.manifest.upsert(manifestEntryFromRecord(key, record, now));
    const candidates = this.manifest.evictionCandidates(
      this.config.persistent.max_items,
      this.config.persistent.max_bytes,
    );
    for (const candidate of candidates) {
      try {
        await persistent.delete(candidate.key);
        this.manifest.delete(candidate.key);
        this.onEvicted([candidate.key]);
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        const message = error instanceof Error ? error.message : String(error);
        cacheLogger.warn(`cache eviction failed for ${candidate.key} [${name}] ${message}`);
        this.metrics.recordError(`[${name}] ${message}`);
        if (error instanceof CacheUnavailableError || error instanceof DOMException) this.notePersistentError();
        break;
      }
    }
  }

  getConfig(): ClodCacheConfig { return this.config; }

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
      await this.hydrateManifest();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : String(error);
      cacheLogger.debug(`manifest hydrate skipped [${name}] ${message}`);
    }
  }

  private async hydrateManifest(): Promise<void> {
    if (!this.persistent) return;
    const keys = await this.persistent.keys();
    const maxScan = Math.min(keys.length, 256);
    for (let i = 0; i < maxScan; i++) {
      const key = keys[i]!;
      const record = await this.persistent.get(key);
      if (!record) continue;
      this.manifest.upsert(manifestEntryFromRecord(key, record));
    }
    if (keys.length > maxScan) cacheLogger.debug(`manifest hydrate scanned ${maxScan}/${keys.length} keys`);
  }

  async get<TArtifact>(
    keyParts: ClodCacheKeyParts,
    decode: (payload: ArrayBuffer) => TArtifact,
  ): Promise<ClodCacheGetResult<TArtifact>> {
    const key = buildClodCacheKey(keyParts);
    if (!cacheEffective(this.config)) {
      this.metrics.recordMiss("disabled");
      return miss<TArtifact>(key, "disabled");
    }

    return this.scheduler.scheduleRead(async () => {
      const t0 = performance.now();
      try {
        const record = await loadCachedRecord(key, this.memory, this.persistent);
        if (!record) {
          this.metrics.recordMiss("not-found");
          return miss<TArtifact>(key, "not-found", performance.now() - t0);
        }

        const validationReason = validateCacheHeader(record.header, keyParts, this.config);
        if (validationReason) {
          this.metrics.recordMiss(validationReason);
          void this.delete(keyParts);
          return miss<TArtifact>(key, validationReason, performance.now() - t0);
        }

        const uncompressed = await decompressPayload(record.payload, record.header.compression);
        const checksum = await sha256Hex(uncompressed);
        if (checksum !== record.header.checksum) {
          this.metrics.recordMiss("checksum-mismatch");
          void this.delete(keyParts);
          return miss<TArtifact>(key, "checksum-mismatch", performance.now() - t0);
        }

        const artifact = decode(uncompressed);
        const decodeMs = performance.now() - t0;
        this.metrics.recordHit(record.header.storedBytes, decodeMs);
        if (this.config.debug.log_cache_hits) {
          cacheLogger.debug(`hit ${key} (${record.header.storedBytes} B, ${decodeMs.toFixed(2)} ms)`);
        }
        touchCacheManifest(this.manifest, key, record.header.artifactKind, record.header.storedBytes);
        return {
          status: "hit",
          artifact,
          key,
          bytesRead: record.header.storedBytes,
          decodeMs,
          metadata: record.header.metadata,
        };
      } catch (error) {
        const reason: CacheMissReason = error instanceof CacheChecksumError
          ? "checksum-mismatch"
          : error instanceof CacheUnavailableError
            ? "backend-error"
            : "decode-error";
        const name = error instanceof Error ? error.name : "";
        const message = error instanceof Error ? error.message : String(error);
        cacheLogger.warn(`get failed for ${key} [${name}] ${message}`);
        this.metrics.recordMiss(reason);
        this.metrics.recordError(`[${name}] ${message}`);
        if (isArtifactValidationError(error)) void this.delete(keyParts);
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
        const recordMetadata = {
          ...metadata,
          cacheWriteId: nextCacheWriteId(),
        };
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
          metadata: recordMetadata,
        };
        const record: ClodCacheStoredRecord = { header, payload: compressed.bytes };
        const persistent = this.persistent;
        const commitGated = writeRequiresCommitAcceptance(recordMetadata);

        if (persistent && commitGated) {
          await persistent.put(key, record);
          this.storeInMemory(key, record);
        } else {
          this.storeInMemory(key, record);
          if (persistent) await persistent.put(key, record);
        }

        if (persistent) await this.recordPersistentWrite(persistent, key, record, now);
        const encodeMs = performance.now() - t0;
        this.metrics.recordWrite(record.header.storedBytes, encodeMs);
        return {
          key,
          bytesWritten: record.header.storedBytes,
          encodeMs,
          compression: compressed.mode,
        };
      } catch (error) {
        if (error instanceof CacheWriteRejectedError) {
          return {
            key,
            bytesWritten: 0,
            encodeMs: performance.now() - t0,
            compression: "none",
          };
        }
        const name = error instanceof Error ? error.name : "";
        const message = error instanceof Error ? error.message : String(error);
        cacheLogger.error(`put failed for ${key} [${name}] ${message}`);
        this.metrics.recordError(`[${name}] ${message}`);
        if (error instanceof CacheUnavailableError || error instanceof DOMException) this.notePersistentError();
        if (this.config.strict) throw error;
        return {
          key,
          bytesWritten: 0,
          encodeMs: performance.now() - t0,
          compression: "none",
        };
      }
    });
  }

  async delete(keyParts: ClodCacheKeyParts): Promise<void> {
    const key = buildClodCacheKey(keyParts);
    this.memory?.delete(key);
    this.manifest.delete(key);
    if (this.persistent) await this.persistent.delete(key);
  }

  async deleteIfMatches(
    keyParts: ClodCacheKeyParts,
    expectedMetadata: Readonly<Record<string, string | number | boolean>>,
  ): Promise<boolean> {
    const key = buildClodCacheKey(keyParts);
    const persistent = this.persistent;
    let expectedRecord = this.memory?.peek(key) ?? null;
    if (!expectedRecord && persistent) expectedRecord = await persistent.get(key);
    if (!expectedRecord || !metadataMatches(expectedRecord.header.metadata, expectedMetadata)) return false;

    const persistentDeleted = persistent
      ? await persistent.deleteIfMatches(key, expectedRecord)
      : false;

    const currentMemory = this.memory?.peek(key) ?? null;
    let memoryDeleted = false;
    if (currentMemory && cacheRecordVersionMatches(currentMemory, expectedRecord)) {
      this.memory?.delete(key);
      memoryDeleted = true;
    }

    let remainingPersistent: ClodCacheStoredRecord | null = null;
    if (persistent && !persistentDeleted) {
      try {
        remainingPersistent = await persistent.get(key);
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        const message = error instanceof Error ? error.message : String(error);
        cacheLogger.warn(`cache manifest reconciliation failed for ${key} [${name}] ${message}`);
        this.metrics.recordError(`[${name}] ${message}`);
      }
    }
    if (remainingPersistent) {
      this.manifest.upsert(manifestEntryFromRecord(key, remainingPersistent));
    } else if (!this.memory?.peek(key) && (persistentDeleted || !persistent)) {
      this.manifest.delete(key);
    }
    return persistentDeleted || memoryDeleted;
  }

  async clear(): Promise<void> {
    this.clearMemory();
    await this.clearPersistent();
  }

  clearMemory(): void { this.memory?.clear(); }

  async clearPersistent(): Promise<void> {
    this.manifest.clear();
    if (this.persistent) {
      await this.persistent.clear();
      await this.persistent.putManifestEntries([]);
    }
  }

  async flush(): Promise<void> { await this.scheduler.flush(); }

  private onEvicted(keys: string[]): void {
    if (keys.length === 0) return;
    this.metrics.recordEviction(keys.length);
    if (this.config.debug.log_cache_evictions) cacheLogger.info(`evicted ${keys.length} entries`);
  }
}

export function createClodCacheService(
  config: ClodCacheConfig,
  persistentOverride?: PersistentCacheStore | null,
  role: CachePersistenceRole = "worker",
): ClodCacheService {
  return new ClodCacheServiceImpl(config, persistentOverride, role);
}
