import { describe, expect, it } from "vitest";
import { parseConfig } from "../../config.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../../terrain/border_coast_config.js";
import configText from "../../../config/clod_pages.yaml?raw";
import { initClodCacheContext } from "../clodCacheContext.js";
import { buildWorldAsyncWithCache } from "../clodBuildCache.js";
import type { TerrainSourceInputs } from "../terrainSource.js";

const memoryOnlyCacheConfig = `
cache:
  enabled: true
  namespace: "test-clod-poc"
  schema_version: 1
  builder_version: "test-cache-v1"
  strict: false
  memory:
    enabled: true
    max_items: 128
    max_bytes: 67108864
  persistent:
    enabled: false
    backend: "indexeddb"
    database_name: "unused"
    object_store_name: "artifacts"
    max_items: 128
    max_bytes: 67108864
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
    read_budget_per_frame: 64
    write_budget_per_frame: 64
    max_decode_ms_per_frame: 64
    max_encode_ms_per_frame: 64
    keep_stale_until_replacement: true
  debug:
    log_cache_hits: false
    log_cache_misses: false
    log_cache_evictions: false
    expose_overlay_stats: false
`;

function terrainSource(): TerrainSourceInputs {
  return {
    scene: "infinite-islands",
    worldSeed: "1",
    worldPages: 1,
    generatorVersion: "0.22.0",
    digRevision: 0,
    hydrologyTerrain: null,
    borderCoastOceanConfig: DEFAULT_BORDER_COAST_OCEAN_CONFIG,
    waterConfig: {
      enabled: false,
      source: "fake_bodies",
      fakeBodies: { carveTerrain: false },
      hydrology: { enabled: false, unifiedStartup: false },
    },
    proceduralTextureEnabled: false,
    proceduralTextureHash: null,
    stagedImportHash: null,
    voxelSnapshotHash: "empty",
    longViewScene: true,
  };
}

describe("CLOD build cache", () => {
  it("loads identical startup nodes from cache without rebuilding them", async () => {
    const cfg = parseConfig(configText);
    const ctx = await initClodCacheContext({
      cfg,
      worldPages: 1,
      terrainSource: terrainSource(),
      cacheConfigText: memoryOnlyCacheConfig,
      role: "worker",
    });

    const first = await buildWorldAsyncWithCache(1, 1, cfg, () => undefined, ctx);
    expect(first.cacheStats.nodesBuilt).toBeGreaterThan(0);
    expect(first.cacheStats.nodesFromCache).toBe(0);

    const second = await buildWorldAsyncWithCache(1, 1, cfg, () => undefined, ctx);
    expect(second.cacheStats.nodesBuilt).toBe(0);
    expect(second.cacheStats.nodesFromCache).toBeGreaterThan(0);
    expect(second.cacheStats.cacheMisses).toBe(0);
  });
});
