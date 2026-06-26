export type {
  ClodCacheArtifactKind,
  ClodCacheKeyParts,
  ClodCacheRecordHeader,
  ClodCacheStoredRecord,
  ClodCacheGetResult,
  ClodCachePutResult,
  ClodCacheManifestEntry,
  CacheMissReason,
} from "./cacheTypes.js";

export {
  parseClodCacheConfig,
  setCacheSessionDisabled,
  isCacheSessionDisabled,
  isCacheEffective,
  type ClodCacheConfig,
} from "./cacheConfig.js";

export { buildClodCacheKey, encodeNodeIdForKey, parsePageCoordsFromNodeId } from "./cacheKey.js";
export { computeCacheConfigHash } from "./cacheHash.js";
export {
  computeTerrainSourceHash,
  buildStagedImportHash,
  buildProceduralTextureHash,
  canonicalizeDigEdits,
  normalizeTerrainSourceInputs,
  hashHydrologyTerrain,
  hashBorderCoastConfig,
  type TerrainSourceInputs,
} from "./terrainSource.js";
export { encodeBuildStatMetadata, decodeBuildStatFromMetadata } from "./cacheBuildStatMetadata.js";
export { clearWorkerPersistentCache } from "./clodCacheContext.js";
export {
  setWorkerCacheSnapshot,
  getWorkerCacheBuildStats,
  getWorkerCacheServiceMetrics,
} from "./cacheMetricsBridge.js";
export { type WorkerCacheBuildStats } from "./cacheMetrics.js";
export { sha256Hex } from "./checksum.js";
export { compressPayload, decompressPayload } from "./compression.js";
export {
  encodeClodPageNodeArtifact,
  decodeClodPageNodeArtifact,
  encodeClodPageTreeArtifact,
  decodeClodPageTreeArtifact,
  encodeTerrainSummaryArtifact,
  decodeTerrainSummaryArtifact,
  type ClodPageNodeArtifact,
  type ClodPageTreeArtifact,
  type TerrainSummaryArtifact,
} from "./artifactSerializer.js";
export { createClodCacheService, type ClodCacheService } from "./cacheService.js";
export {
  createEmptyCacheMetrics,
  hitRate,
  averageDecodeMs,
  averageEncodeMs,
  type ClodCacheMetrics,
} from "./cacheMetrics.js";
export {
  CacheUnavailableError,
  CacheCorruptError,
  CacheDecodeError,
  CacheChecksumError,
  CacheConfigError,
} from "./cacheErrors.js";
export { InMemoryPersistentStore, type CachePersistenceRole, resolvePersistentConfig, resolveBrokerPersistentConfig, prepareWorkerPersistentStore, purgeLegacyCacheDatabases } from "./indexedDbStore.js";
export { attachMainThreadCacheBroker, clearMainThreadCacheBroker } from "./mainThreadCacheBroker.js";
export { initClodCacheContext, getClodCacheContext, type ClodCacheContext } from "./clodCacheContext.js";
export { loadTerrainSummaryWithCache, loadTerrainSummaryWithCacheSimple } from "./terrainSummaryCache.js";
export { buildWorldAsyncWithCache, type CachedBuildStats } from "./clodBuildCache.js";
export { createCacheDebugOverlay, type CacheDebugOverlay, type CacheDebugOverlayDeps } from "./cacheDebugOverlay.js";
