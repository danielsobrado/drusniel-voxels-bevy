import { load } from "js-yaml";
import terrainMaterialCacheYaml from "../../../config/terrain_material_cache.yaml?raw";

export const TERRAIN_MATERIAL_CACHE_FORMATS = ["rgba8", "rg8", "rg16f", "none"] as const;
export type TerrainMaterialCacheFormat = typeof TERRAIN_MATERIAL_CACHE_FORMATS[number];

export const TERRAIN_MATERIAL_CACHE_DEBUG_CHANNELS = [
  "none",
  "cache_tiles",
  "macro_tint",
  "slope",
  "curvature",
  "material_weights",
  "wetness_shoreline_foam",
  "far_color",
  "far_normal",
  "coverage",
  "fallback_reason",
] as const;
export type TerrainMaterialCacheDebugChannel = typeof TERRAIN_MATERIAL_CACHE_DEBUG_CHANNELS[number];

export interface TerrainMaterialCacheConfig {
  enabled: boolean;
  budget: {
    maxBytes: number;
  };
  bake: {
    async: boolean;
    maxTilesBakedPerFrame: number;
    maxCpuMsPerFrame: number;
    bakeNearPages: boolean;
    bakeFarTiles: boolean;
    keepStaleUntilReady: boolean;
  };
  invalidation: {
    revisionDriven: boolean;
    invalidateOnMaterialSettingsChange: boolean;
    invalidateOnWaterRevisionChange: boolean;
    invalidateOnVegetationCoverageRevisionChange: boolean;
  };
  formats: {
    macroTint: TerrainMaterialCacheFormat;
    slopeCurvature: TerrainMaterialCacheFormat;
    materialWeights: TerrainMaterialCacheFormat;
    wetnessShoreline: TerrainMaterialCacheFormat;
    farColor: TerrainMaterialCacheFormat;
    farNormal: TerrainMaterialCacheFormat;
    coverage: TerrainMaterialCacheFormat;
  };
  sampling: {
    pageResolution: number;
    farTileResolution: number;
    deriveFarNormalFromHeightWhenPossible: boolean;
    normalStorageDistanceThreshold: number;
  };
  quality: {
    nearMode: string;
    midMode: string;
    farMode: string;
    fallbackMode: string;
  };
  debug: {
    showCacheTiles: boolean;
    showInvalidations: boolean;
    showFormatChannels: TerrainMaterialCacheDebugChannel;
    forceRebake: boolean;
    disableCache: boolean;
  };
}

export const DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG: TerrainMaterialCacheConfig = {
  enabled: true,
  budget: { maxBytes: 64 * 1024 * 1024 },
  bake: {
    async: true,
    maxTilesBakedPerFrame: 2,
    maxCpuMsPerFrame: 1.0,
    bakeNearPages: true,
    bakeFarTiles: true,
    keepStaleUntilReady: true,
  },
  invalidation: {
    revisionDriven: true,
    invalidateOnMaterialSettingsChange: true,
    invalidateOnWaterRevisionChange: true,
    invalidateOnVegetationCoverageRevisionChange: true,
  },
  formats: {
    macroTint: "rgba8",
    slopeCurvature: "rg8",
    materialWeights: "rgba8",
    wetnessShoreline: "rg8",
    farColor: "rgba8",
    farNormal: "rg16f",
    coverage: "rg8",
  },
  sampling: {
    pageResolution: 64,
    farTileResolution: 96,
    deriveFarNormalFromHeightWhenPossible: true,
    normalStorageDistanceThreshold: 256.0,
  },
  quality: {
    nearMode: "live_full_or_cached_debug",
    midMode: "cached_material_weights",
    farMode: "cached_far_color",
    fallbackMode: "existing_shader_path",
  },
  debug: {
    showCacheTiles: false,
    showInvalidations: false,
    showFormatChannels: "none",
    forceRebake: false,
    disableCache: false,
  },
};

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : Boolean(value);
}

function num(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, value) : fallback;
}

function int(value: unknown, fallback: number, min = 0): number {
  return Math.max(min, Math.floor(num(value, fallback, min)));
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function format(value: unknown, fallback: TerrainMaterialCacheFormat): TerrainMaterialCacheFormat {
  return TERRAIN_MATERIAL_CACHE_FORMATS.includes(value as TerrainMaterialCacheFormat)
    ? value as TerrainMaterialCacheFormat
    : fallback;
}

function debugChannel(value: unknown, fallback: TerrainMaterialCacheDebugChannel): TerrainMaterialCacheDebugChannel {
  return TERRAIN_MATERIAL_CACHE_DEBUG_CHANNELS.includes(value as TerrainMaterialCacheDebugChannel)
    ? value as TerrainMaterialCacheDebugChannel
    : fallback;
}

export function parseTerrainMaterialCacheConfig(text = terrainMaterialCacheYaml): TerrainMaterialCacheConfig {
  const parsed = record(load(text));
  const root = record(parsed.terrain_material_cache);
  const fallback = DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG;
  const budget = record(root.budget);
  const bake = record(root.bake);
  const invalidation = record(root.invalidation);
  const formats = record(root.formats);
  const sampling = record(root.sampling);
  const quality = record(root.quality);
  const debug = record(root.debug);

  return {
    enabled: bool(root.enabled, fallback.enabled),
    budget: {
      maxBytes: int(budget.max_bytes, fallback.budget.maxBytes, 1),
    },
    bake: {
      async: bool(bake.async, fallback.bake.async),
      maxTilesBakedPerFrame: int(bake.max_tiles_baked_per_frame, fallback.bake.maxTilesBakedPerFrame, 0),
      maxCpuMsPerFrame: num(bake.max_cpu_ms_per_frame, fallback.bake.maxCpuMsPerFrame, 0),
      bakeNearPages: bool(bake.bake_near_pages, fallback.bake.bakeNearPages),
      bakeFarTiles: bool(bake.bake_far_tiles, fallback.bake.bakeFarTiles),
      keepStaleUntilReady: bool(bake.keep_stale_until_ready, fallback.bake.keepStaleUntilReady),
    },
    invalidation: {
      revisionDriven: bool(invalidation.revision_driven, fallback.invalidation.revisionDriven),
      invalidateOnMaterialSettingsChange: bool(invalidation.invalidate_on_material_settings_change, fallback.invalidation.invalidateOnMaterialSettingsChange),
      invalidateOnWaterRevisionChange: bool(invalidation.invalidate_on_water_revision_change, fallback.invalidation.invalidateOnWaterRevisionChange),
      invalidateOnVegetationCoverageRevisionChange: bool(invalidation.invalidate_on_vegetation_coverage_revision_change, fallback.invalidation.invalidateOnVegetationCoverageRevisionChange),
    },
    formats: {
      macroTint: format(formats.macro_tint, fallback.formats.macroTint),
      slopeCurvature: format(formats.slope_curvature, fallback.formats.slopeCurvature),
      materialWeights: format(formats.material_weights, fallback.formats.materialWeights),
      wetnessShoreline: format(formats.wetness_shoreline, fallback.formats.wetnessShoreline),
      farColor: format(formats.far_color, fallback.formats.farColor),
      farNormal: format(formats.far_normal, fallback.formats.farNormal),
      coverage: format(formats.coverage, fallback.formats.coverage),
    },
    sampling: {
      pageResolution: int(sampling.page_resolution, fallback.sampling.pageResolution, 1),
      farTileResolution: int(sampling.far_tile_resolution, fallback.sampling.farTileResolution, 1),
      deriveFarNormalFromHeightWhenPossible: bool(sampling.derive_far_normal_from_height_when_possible, fallback.sampling.deriveFarNormalFromHeightWhenPossible),
      normalStorageDistanceThreshold: num(sampling.normal_storage_distance_threshold, fallback.sampling.normalStorageDistanceThreshold, 0),
    },
    quality: {
      nearMode: str(quality.near_mode, fallback.quality.nearMode),
      midMode: str(quality.mid_mode, fallback.quality.midMode),
      farMode: str(quality.far_mode, fallback.quality.farMode),
      fallbackMode: str(quality.fallback_mode, fallback.quality.fallbackMode),
    },
    debug: {
      showCacheTiles: bool(debug.show_cache_tiles, fallback.debug.showCacheTiles),
      showInvalidations: bool(debug.show_invalidations, fallback.debug.showInvalidations),
      showFormatChannels: debugChannel(debug.show_format_channels, fallback.debug.showFormatChannels),
      forceRebake: bool(debug.force_rebake, fallback.debug.forceRebake),
      disableCache: bool(debug.disable_cache, fallback.debug.disableCache),
    },
  };
}

export const defaultTerrainMaterialCacheConfig = parseTerrainMaterialCacheConfig();
