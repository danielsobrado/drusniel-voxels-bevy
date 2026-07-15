import heightfieldTileConfigText from "../../../config/heightfield_tiles.yaml?raw";
import { setTerrainSurfaceOverride } from "../../terrain/terrain.js";
import type { StartupHeightfieldRaster } from "../../terrain/startup_heightfield_raster.js";
import {
  proceduralHeightfieldSampler,
  startupRasterHeightfieldSampler,
  type HeightfieldSampler,
} from "../heightfield_sampler.js";
import type { TerrainSourceInputs } from "../../cache/terrainSource.js";
import type { WorldTileKey } from "../tile_key.js";
import {
  HeightfieldTileCache,
  type HeightfieldTileBuildResult,
  type HeightfieldTileCacheCounters,
} from "./heightfield_tile_cache.js";
import {
  heightfieldTilesEnabled,
  parseHeightfieldTileConfig,
} from "./heightfield_tile_config.js";
import {
  heightfieldTileSampler,
  publishHeightfieldTileCounters,
} from "./heightfield_tile_sampler.js";
import {
  IndexedDbHeightfieldTileStore,
  openHeightfieldTileDb,
} from "./heightfield_tile_store.js";
import {
  heightfieldTileGpuAtlasStats,
  invalidateHeightfieldTileGpuAtlasBounds,
  registerHeightfieldTileGpuSource,
  unregisterHeightfieldTileGpuSource,
  updateHeightfieldTileGpuAtlas,
} from "./heightfield_tile_gpu_atlas.js";

export interface HeightfieldTileRuntimeUpdate {
  x: number;
  z: number;
  frameIndex: number;
  deltaSeconds?: number;
  velocityX?: number;
  velocityZ?: number;
  buildAllowed?: boolean;
}

export interface HeightfieldTileRuntime {
  readonly cache: HeightfieldTileCache;
  readonly authoritative: boolean;
  update(input: HeightfieldTileRuntimeUpdate): void;
  counters(): HeightfieldTileCacheCounters;
  invalidateBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): number;
  dispose(): void;
}

export interface CreateHeightfieldTileRuntimeInput {
  terrainSource: TerrainSourceInputs;
  startupHeightfield: StartupHeightfieldRaster | null;
  fallbackSampler?: HeightfieldSampler;
  buildTiles(keys: readonly WorldTileKey[], sourceRevision: number): Promise<HeightfieldTileBuildResult>;
  searchParams?: URLSearchParams;
}

const DISABLED_COUNTERS: HeightfieldTileCacheCounters = Object.freeze({
  enabled: 0,
  resident: 0,
  required: 0,
  pending: 0,
  inflight: 0,
  buildsTotal: 0,
  buildMsP95: 0,
  evictionsTotal: 0,
  fallbackSamplesThisFrame: 0,
  fallbackSamplesTotal: 0,
  bytesResident: 0,
  storeHits: 0,
  storeMisses: 0,
  storeErrors: 0,
  failuresTotal: 0,
});

function diagnosticsCounters(): Record<string, number> | null {
  return window.__drusnielClod?.stats?.counters ?? null;
}

function publishInitialCounters(counters: HeightfieldTileCacheCounters): void {
  const startupTimings = window.__drusnielStartupTimings;
  if (startupTimings) publishHeightfieldTileCounters(startupTimings, counters);
  publishHeightfieldTileCounters(diagnosticsCounters(), counters);
}

function legacySurfaceOverrideActive(input: CreateHeightfieldTileRuntimeInput): boolean {
  if (input.startupHeightfield) return false;
  return input.terrainSource.hydrologyTerrain !== null
    || input.terrainSource.waterConfig.fakeBodies.carveTerrain;
}

export async function createHeightfieldTileRuntime(
  input: CreateHeightfieldTileRuntimeInput,
): Promise<HeightfieldTileRuntime | null> {
  if (typeof window === "undefined") return null;
  const config = parseHeightfieldTileConfig(heightfieldTileConfigText);
  const searchParams = input.searchParams ?? new URLSearchParams(window.location.search);
  if (input.terrainSource.worldMode === "continent"
    && !input.terrainSource.worldManifest?.artifacts.hydrologyGraph) {
    publishInitialCounters(DISABLED_COUNTERS);
    return null;
  }
  if (!heightfieldTilesEnabled(config, searchParams, input.terrainSource.worldMode ?? "finite")) {
    publishInitialCounters(DISABLED_COUNTERS);
    return null;
  }
  if (legacySurfaceOverrideActive(input)) {
    console.warn("[heightfield-tiles] disabled because a legacy carved surface override is active");
    publishInitialCounters(DISABLED_COUNTERS);
    return null;
  }

  const manifest = input.terrainSource.worldManifest;
  if (!manifest) throw new Error("heightfield tiles require the Phase 1 world manifest");

  let store: IndexedDbHeightfieldTileStore | null = null;
  if (config.persistenceEnabled) {
    try {
      const db = await openHeightfieldTileDb();
      store = new IndexedDbHeightfieldTileStore(db, manifest.terrainSourceHash);
    } catch (error) {
      console.warn("[heightfield-tiles] persistence unavailable; continuing with memory cache", error);
    }
  }

  const sourceRevision = 0;
  const cache = new HeightfieldTileCache(
    config,
    sourceRevision,
    (keys, revision) => input.buildTiles(keys, revision),
    store,
  );
  const procedural = input.fallbackSampler ?? proceduralHeightfieldSampler(sourceRevision);
  const startup = input.startupHeightfield
    ? startupRasterHeightfieldSampler(input.startupHeightfield, sourceRevision)
    : null;
  const sampler = heightfieldTileSampler(cache, procedural, startup);
  setTerrainSurfaceOverride(sampler.sampleHeight);
  const authoritative = input.terrainSource.worldMode === "continent" && Boolean(manifest.artifacts.hydrologyGraph);
  registerHeightfieldTileGpuSource(cache, authoritative);

  const runtime: HeightfieldTileRuntime = {
    cache,
    authoritative,
    update(updateInput) {
      cache.update(updateInput);
      updateHeightfieldTileGpuAtlas(updateInput.x, updateInput.z);
      const gpuAtlas = heightfieldTileGpuAtlasStats();
      const counters = diagnosticsCounters();
      if (counters) {
        counters["heightfield_tile_gpu_atlas_enabled"] = gpuAtlas.enabled;
        counters["heightfield_tile_gpu_atlas_uploads"] = gpuAtlas.uploads;
        counters["heightfield_tile_gpu_atlas_resident"] = gpuAtlas.resident;
      }
      publishHeightfieldTileCounters(diagnosticsCounters(), cache.counters());
    },
    counters: () => cache.counters(),
    invalidateBounds(bounds) {
      const count = cache.invalidateBounds(bounds);
      invalidateHeightfieldTileGpuAtlasBounds(cache, bounds);
      return count;
    },
    dispose() {
      cache.clear();
      unregisterHeightfieldTileGpuSource(cache);
      store?.close();
      setTerrainSurfaceOverride(startup?.sampleHeight ?? procedural.sampleHeight);
      publishHeightfieldTileCounters(diagnosticsCounters(), DISABLED_COUNTERS);
    },
  };
  publishInitialCounters(cache.counters());
  console.info("[heightfield-tiles] enabled", {
    radiusM: config.radiusM,
    maxResidentTiles: config.maxResidentTiles,
    persistence: store !== null,
  });
  return runtime;
}
