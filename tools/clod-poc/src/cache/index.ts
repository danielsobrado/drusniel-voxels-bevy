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

export { buildClodCacheKey, parsePageCoordsFromNodeId } from "./cacheKey.js";
export { computeCacheConfigHash, computeSourceRevisionPoC, computePageSourceHash } from "./cacheHash.js";
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
export { InMemoryPersistentStore } from "./indexedDbStore.js";
export { initClodCacheContext, getClodCacheContext, type ClodCacheContext } from "./clodCacheContext.js";
export { loadTerrainSummaryWithCache, loadTerrainSummaryWithCacheSimple } from "./terrainSummaryCache.js";
export { buildWorldAsyncWithCache, type CachedBuildStats } from "./clodBuildCache.js";
export { createCacheDebugOverlay, type CacheDebugOverlay } from "./cacheDebugOverlay.js";
