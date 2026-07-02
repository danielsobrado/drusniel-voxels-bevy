import type { ClodCacheConfig } from "./cacheConfig.js";
import type { ClodCacheGetResult, ClodCacheKeyParts, ClodCacheStoredRecord, CacheMissReason } from "./cacheTypes.js";
import type { PersistentCacheStore } from "./indexedDbStore.js";
import { ClodCacheManifest } from "./cacheManifest.js";
import { CacheChecksumError, CacheCorruptError, CacheDecodeError, CacheUnavailableError } from "./cacheErrors.js";

export function miss<T>(key: string, reason: CacheMissReason, decodeMs = 0): ClodCacheGetResult<T> {
  return { status: "miss", reason, key, bytesRead: 0, decodeMs };
}

export function isArtifactValidationError(error: unknown): boolean {
  return error instanceof CacheCorruptError
    || error instanceof CacheDecodeError
    || error instanceof CacheChecksumError;
}

export function validateCacheHeader(
  header: ClodCacheStoredRecord["header"],
  keyParts: ClodCacheKeyParts,
  config: ClodCacheConfig,
): CacheMissReason | null {
  if (header.schemaVersion !== config.schema_version) return "schema-mismatch";
  if (header.artifactKind !== keyParts.artifactKind) return "schema-mismatch";
  if (config.invalidation.include_builder_version && header.builderVersion !== keyParts.builderVersion) return "builder-version-mismatch";
  if (config.invalidation.include_generator_version && header.generatorVersion !== keyParts.generatorVersion) return "generator-version-mismatch";
  if (config.invalidation.include_world_seed && header.worldSeed !== keyParts.worldSeed) return "world-seed-mismatch";
  if (config.invalidation.include_source_revision && header.sourceRevision !== keyParts.sourceRevision) return "source-revision-mismatch";
  if (config.invalidation.include_config_hash && header.configHash !== keyParts.configHash) return "config-hash-mismatch";
  if (config.invalidation.include_source_hash && header.sourceHash !== keyParts.sourceHash) return "source-hash-mismatch";
  return null;
}

export async function loadCachedRecord(
  key: string,
  memory: { get(k: string): ClodCacheStoredRecord | null; put(k: string, v: ClodCacheStoredRecord): void } | null,
  persistent: PersistentCacheStore | null,
): Promise<ClodCacheStoredRecord | null> {
  const fromMemory = memory?.get(key) ?? null;
  if (fromMemory) return fromMemory;
  if (!persistent) return null;
  try {
    const record = await persistent.get(key);
    if (record && memory) memory.put(key, record);
    return record;
  } catch (error) {
    if (error instanceof CacheUnavailableError) return null;
    throw error;
  }
}

export function touchCacheManifest(
  manifest: ClodCacheManifest,
  key: string,
  artifactKind: ClodCacheStoredRecord["header"]["artifactKind"],
  storedBytes: number,
): void {
  const now = Date.now();
  const existing = manifest.getEntry(key);
  if (existing) {
    manifest.touchHit(key, now);
  } else {
    manifest.upsert({ key, artifactKind, createdAtUnixMs: now, lastAccessedUnixMs: now, hitCount: 1, storedBytes });
  }
}
