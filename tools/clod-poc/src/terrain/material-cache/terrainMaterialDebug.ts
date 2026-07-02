import type { TerrainMaterialCache } from "./terrainMaterialCache.js";
import type { TerrainMaterialCacheCounters } from "./terrainMaterialCacheTypes.js";

export function terrainMaterialCacheCountersForHud(cache: TerrainMaterialCache): Record<string, number> {
  const counters: TerrainMaterialCacheCounters = cache.counters();
  return {
    terrainMaterialCacheHits: counters.terrainMaterialCacheHits,
    terrainMaterialCacheMisses: counters.terrainMaterialCacheMisses,
    terrainMaterialCacheQueued: counters.terrainMaterialCacheQueued,
    terrainMaterialCacheBaking: counters.terrainMaterialCacheBaking,
    terrainMaterialCacheReady: counters.terrainMaterialCacheReady,
    terrainMaterialCacheStale: counters.terrainMaterialCacheStale,
    terrainMaterialCacheFailed: counters.terrainMaterialCacheFailed,
    terrainMaterialCacheEvictions: counters.terrainMaterialCacheEvictions,
    terrainMaterialCacheBytes: counters.terrainMaterialCacheBytes,
    terrainMaterialBakeMs: counters.terrainMaterialBakeMs,
    terrainMaterialUploadMs: counters.terrainMaterialUploadMs,
  };
}

export function terrainMaterialCacheDebugLine(cache: TerrainMaterialCache): string {
  const c = cache.counters();
  return `material cache h/m ${c.terrainMaterialCacheHits}/${c.terrainMaterialCacheMisses} ready ${c.terrainMaterialCacheReady} stale ${c.terrainMaterialCacheStale} bytes ${c.terrainMaterialCacheBytes}`;
}
