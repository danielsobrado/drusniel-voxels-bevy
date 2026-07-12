import heightfieldTileConfigText from "../../../config/heightfield_tiles.yaml?raw";
import { setTerrainSurfaceOverride } from "../../terrain/terrain.js";
import type { StartupHeightfieldRaster } from "../../terrain/startup_heightfield_raster.js";
import {
  proceduralHeightfieldSampler,
  startupRasterHeightfieldSampler,
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

export interface HeightfieldTileRuntimeUpdate {
  x: number;
  z: number;
  frameIndex: number;
  deltaSeconds?: number;
  velocityX?: number;
  velocityZ?: number;
}

export interface HeightfieldTileRuntime {
  readonly cache: HeightfieldTileCache;
  update(input: HeightfieldTileRuntimeUpdate): void;
  counters(): HeightfieldTileCacheCounters;
  dispose(): void;
}

export interface CreateHeightfieldTileRuntimeInput {
  terrainSource: TerrainSourceInputs;
  startupHeightfield: StartupHeightfieldRaster | null;
  buildTiles(keys: readonly WorldTileKey[], sourceRevision: number): Promise<HeightfieldTileBuildResult>;
  searchParams?: URLSearchParams;
}

function diagnosticsCounters(): Record<string, number> | null {
  return window.__drusnielClod?.stats?.counters ?? null;
}

function publishDisabledCounters(): void {
  publishHeightfieldTileCounters(diagnosticsCounters(), {
    enabled: 0,
    resident: 0,
    required: 0,
    pending: 0,
    inflight: 0,
    buildsTotal: 0,
    buildMsP95: 0,
    evictionsTotal: 0,
    fallbackSamplesTotal: 0,
    bytesResident: 0,
    storeHits: 0,
    storeMisses: 0,
    storeErrors: 0,
    failuresTotal: 0,
  });
}

export async function createHeightfieldTileRuntime(
  input: CreateHeightfieldTileRuntimeInput,
): Promise<HeightfieldTileRuntime | null> {
  if (typeof window === "undefined") return null;
  const config = parseHeightfieldTileConfig(heightfieldTileConfigText);
  const searchParams = input.searchParams ?? new URLSearchParams(window.location.search);
  if (!heightfieldTilesEnabled(config, searchParams, input.terrainSource.worldMode)) {
    publishDisabledCounters();
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
  const procedural = proceduralHeightfieldSampler(sourceRevision);
  const startup = input.startupHeightfield
    ? startupRasterHeightfieldSampler(input.startupHeightfield, sourceRevision)
    : null;
  const sampler = heightfieldTileSampler(cache, procedural, startup);
  setTerrainSurfaceOverride(sampler.sampleHeight);

  const runtime: HeightfieldTileRuntime = {
    cache,
    update(updateInput) {
      cache.update(updateInput);
      publishHeightfieldTileCounters(diagnosticsCounters(), cache.counters());
    },
    counters: () => cache.counters(),
    dispose() {
      cache.clear();
      setTerrainSurfaceOverride(startup?.sampleHeight ?? procedural.sampleHeight);
      publishDisabledCounters();
    },
  };
  publishHeightfieldTileCounters(diagnosticsCounters(), cache.counters());
  console.info("[heightfield-tiles] enabled", {
    radiusM: config.radiusM,
    maxResidentTiles: config.maxResidentTiles,
    persistence: store !== null,
  });
  return runtime;
}
