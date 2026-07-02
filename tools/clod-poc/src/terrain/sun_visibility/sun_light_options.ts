import { load } from "js-yaml";

export interface SunLightOptions {
  active: boolean;
  diagnostics: boolean;
  tile: {
    sizeWorld: number;
    resolution: number;
  };
  directionBins: {
    azimuthDegrees: number;
    elevationDegrees: number;
    minElevationDegrees: number;
  };
  ray: {
    maxDistanceWorld: number;
    stepWorld: number;
    receiverHeightBias: number;
    terrainHeightBias: number;
    missingOccludesFog: boolean;
  };
  build: {
    maxTilesPerFrame: number;
    maxBuildMsPerFrame: number;
  };
  cache: {
    maxEntries: number;
    keepLastKnown: boolean;
  };
  debugView: {
    active: boolean;
    showMissing: boolean;
    opacity: number;
    cameraTileRadius: number;
    maxDebugTiles: number;
  };
}

export const SUN_LIGHT_DEFAULTS: SunLightOptions = {
  active: true,
  diagnostics: false,
  tile: { sizeWorld: 128, resolution: 32 },
  directionBins: { azimuthDegrees: 5, elevationDegrees: 5, minElevationDegrees: 2 },
  ray: {
    maxDistanceWorld: 2048,
    stepWorld: 8,
    receiverHeightBias: 0.75,
    terrainHeightBias: 0.25,
    missingOccludesFog: true,
  },
  build: {
    maxTilesPerFrame: 2,
    maxBuildMsPerFrame: 1,
  },
  cache: { maxEntries: 512, keepLastKnown: true },
  debugView: {
    active: false,
    showMissing: true,
    opacity: 0.55,
    cameraTileRadius: 1,
    maxDebugTiles: 12,
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  return Math.floor(asPositive(value, fallback));
}

function asNonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function parseSunLightOptions(value: unknown): SunLightOptions {
  const raw = asRecord(value);
  const tile = asRecord(raw.tile);
  const directionBins = asRecord(raw.direction_bins ?? raw.directionBins);
  const ray = asRecord(raw.ray);
  const build = asRecord(raw.build);
  const cache = asRecord(raw.cache);
  const debugView = asRecord(raw.debug_view ?? raw.debugView);
  return {
    active: asBool(raw.active ?? raw.enabled, SUN_LIGHT_DEFAULTS.active),
    diagnostics: asBool(raw.diagnostics ?? raw.debug, SUN_LIGHT_DEFAULTS.diagnostics),
    tile: {
      sizeWorld: asPositive(tile.size_world ?? tile.sizeWorld, SUN_LIGHT_DEFAULTS.tile.sizeWorld),
      resolution: asPositiveInt(tile.resolution, SUN_LIGHT_DEFAULTS.tile.resolution),
    },
    directionBins: {
      azimuthDegrees: asPositive(directionBins.azimuth_degrees ?? directionBins.azimuthDegrees, SUN_LIGHT_DEFAULTS.directionBins.azimuthDegrees),
      elevationDegrees: asPositive(directionBins.elevation_degrees ?? directionBins.elevationDegrees, SUN_LIGHT_DEFAULTS.directionBins.elevationDegrees),
      minElevationDegrees: asPositive(directionBins.min_elevation_degrees ?? directionBins.minElevationDegrees, SUN_LIGHT_DEFAULTS.directionBins.minElevationDegrees),
    },
    ray: {
      maxDistanceWorld: asPositive(ray.max_distance_world ?? ray.maxDistanceWorld, SUN_LIGHT_DEFAULTS.ray.maxDistanceWorld),
      stepWorld: asPositive(ray.step_world ?? ray.stepWorld, SUN_LIGHT_DEFAULTS.ray.stepWorld),
      receiverHeightBias: asPositive(ray.receiver_height_bias ?? ray.receiverHeightBias, SUN_LIGHT_DEFAULTS.ray.receiverHeightBias),
      terrainHeightBias: asPositive(ray.terrain_height_bias ?? ray.terrainHeightBias, SUN_LIGHT_DEFAULTS.ray.terrainHeightBias),
      missingOccludesFog: asBool(ray.missing_casts_shade ?? ray.missing_occludes_fog ?? ray.missingOccludesFog, SUN_LIGHT_DEFAULTS.ray.missingOccludesFog),
    },
    build: {
      maxTilesPerFrame: asPositiveInt(build.max_tiles_per_frame ?? build.maxTilesPerFrame, SUN_LIGHT_DEFAULTS.build.maxTilesPerFrame),
      maxBuildMsPerFrame: asPositive(build.max_build_ms_per_frame ?? build.maxBuildMsPerFrame, SUN_LIGHT_DEFAULTS.build.maxBuildMsPerFrame),
    },
    cache: {
      maxEntries: asPositiveInt(cache.max_entries ?? cache.maxEntries, SUN_LIGHT_DEFAULTS.cache.maxEntries),
      keepLastKnown: asBool(cache.keep_last_known ?? cache.keepLastKnown, SUN_LIGHT_DEFAULTS.cache.keepLastKnown),
    },
    debugView: {
      active: asBool(debugView.active ?? debugView.enabled, SUN_LIGHT_DEFAULTS.debugView.active),
      showMissing: asBool(debugView.show_missing ?? debugView.showMissing, SUN_LIGHT_DEFAULTS.debugView.showMissing),
      opacity: Math.max(0, Math.min(1, asPositive(debugView.opacity, SUN_LIGHT_DEFAULTS.debugView.opacity))),
      cameraTileRadius: asNonNegativeInt(debugView.camera_tile_radius ?? debugView.cameraTileRadius, SUN_LIGHT_DEFAULTS.debugView.cameraTileRadius),
      maxDebugTiles: asPositiveInt(debugView.max_debug_tiles ?? debugView.maxDebugTiles, SUN_LIGHT_DEFAULTS.debugView.maxDebugTiles),
    },
  };
}

export function parseSunLightOptionsYaml(yamlText: string): SunLightOptions {
  try {
    return parseSunLightOptions(load(yamlText));
  } catch {
    return parseSunLightOptions(SUN_LIGHT_DEFAULTS);
  }
}
