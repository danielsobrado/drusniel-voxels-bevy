import { load } from "js-yaml";
import { GRASS_SHADER_MODES, type GrassSettings, type GrassShaderMode } from "./grass_config_types.js";
import { cloneGrassSettings } from "./grass_config_defaults.js";
import { resolveGrassSettings } from "./grass_config_resolve.js";
import {
  readBoolean,
  readFraction,
  readIntegerAtLeast,
  readNumber,
  readNumberAtLeast,
  readWindDirection,
  warnGrassConfig,
} from "./grass_config_readers.js";

type RawObject = Record<string, unknown>;

const DEFAULT_GRASS_RUNTIME_BUDGET = {
  maxInstances: 32000,
  distanceM: 125,
  maxNewPatchesPerFrame: 1,
  refreshDistanceM: 8,
  ringGrid: 512,
  ringCell: 0.8,
  ringDistance: 160,
  ringMaxRadius: 160,
  ringNearMeters: 32,
  ringMidMeters: 82,
  ringFarMeters: 125,
} as const;

function objectFrom(value: unknown): RawObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawObject : {};
}

export function isGrassShaderMode(value: unknown): value is GrassShaderMode {
  return typeof value === "string" && (GRASS_SHADER_MODES as readonly string[]).includes(value);
}

function readShaderMode(raw: RawObject, fallback: GrassSettings, warn: ((message: string) => void) | null): GrassShaderMode {
  if (raw.shader_mode === undefined) return fallback.shaderMode;
  if (isGrassShaderMode(raw.shader_mode)) return raw.shader_mode;
  warnGrassConfig(`invalid shader_mode "${String(raw.shader_mode)}"; using ${fallback.shaderMode}`, warn ?? undefined);
  return fallback.shaderMode;
}

function readYamlGrass(text: string, warn: ((message: string) => void) | null): RawObject | null {
  try {
    return objectFrom(objectFrom(load(text)).grass);
  } catch (error) {
    warnGrassConfig(`failed to parse config/grass.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`, warn ?? undefined);
    return null;
  }
}

function parsePlacement(raw: RawObject, fallback: GrassSettings): GrassSettings["placement"] {
  const placement = objectFrom(raw.placement);
  return {
    spacingM: readNumberAtLeast(placement.spacing_m ?? raw.blade_spacing, fallback.placement.spacingM, 0.05),
    jitter: readFraction(placement.jitter, fallback.placement.jitter),
    slopeMinY: readFraction(placement.slope_min_y ?? raw.slope_min_y, fallback.placement.slopeMinY),
    minHeightM: readNumber(placement.min_height_m ?? raw.min_height, fallback.placement.minHeightM),
    maxHeightM: readNumber(placement.max_height_m ?? raw.max_height, fallback.placement.maxHeightM),
    minGrassWeight: readFraction(placement.min_grass_weight, fallback.placement.minGrassWeight),
  };
}

function parseLod(raw: RawObject, fallback: GrassSettings): GrassSettings["lod"] {
  const lod = objectFrom(raw.lod);
  return {
    nearFraction: readFraction(lod.near_fraction, fallback.lod.nearFraction),
    midFraction: readFraction(lod.mid_fraction, fallback.lod.midFraction),
    farDensityRatio: readFraction(lod.far_density_ratio, fallback.lod.farDensityRatio),
    midInstanceFraction: readFraction(lod.mid_instance_fraction, fallback.lod.midInstanceFraction),
    farInstanceFraction: readFraction(lod.far_instance_fraction, fallback.lod.farInstanceFraction),
    ditherBandM: readNumberAtLeast(lod.dither_band_m, fallback.lod.ditherBandM, 0),
  };
}

function parseBlade(raw: RawObject, fallback: GrassSettings): GrassSettings["blade"] {
  const blade = objectFrom(raw.blade);
  return {
    heightM: readNumberAtLeast(blade.height_m ?? raw.blade_height, fallback.blade.heightM, 0.05),
    heightVariation: readNumberAtLeast(blade.height_variation ?? raw.blade_height_variation, fallback.blade.heightVariation, 0),
    widthM: readNumberAtLeast(blade.width_m ?? raw.blade_width, fallback.blade.widthM, 0.001),
    nearBladesPerInstance: readIntegerAtLeast(blade.near_blades_per_instance, fallback.blade.nearBladesPerInstance, 1),
    midBladesPerInstance: readIntegerAtLeast(blade.mid_blades_per_instance, fallback.blade.midBladesPerInstance, 1),
    nearSegments: readIntegerAtLeast(blade.near_segments, fallback.blade.nearSegments, 1),
    midSegments: readIntegerAtLeast(blade.mid_segments, fallback.blade.midSegments, 1),
    farTuftWidthM: readNumberAtLeast(blade.far_tuft_width_m, fallback.blade.farTuftWidthM, 0.01),
    nearCrossedQuads: readBoolean(blade.near_crossed_quads ?? raw.near_crossed_quads, fallback.blade.nearCrossedQuads),
    maxWidthCompensation: readNumberAtLeast(blade.max_width_compensation, fallback.blade.maxWidthCompensation, 1),
  };
}

function parseWind(raw: RawObject, fallback: GrassSettings): GrassSettings["wind"] {
  const wind = objectFrom(raw.wind);
  return {
    direction: readWindDirection(wind.direction, fallback.wind.direction),
    strength: readNumberAtLeast(wind.strength ?? raw.wind_strength, fallback.wind.strength, 0),
    speed: readNumberAtLeast(wind.speed ?? raw.wind_speed, fallback.wind.speed, 0),
    gustStrength: readNumberAtLeast(wind.gust_strength, fallback.wind.gustStrength, 0),
  };
}

function parseRing(raw: RawObject, fallback: GrassSettings): GrassSettings["ring"] {
  const ring = objectFrom(raw.ring);
  const lod = objectFrom(raw.lod);
  return {
    grid: Math.floor(readNumberAtLeast(ring.grid, fallback.ring.grid, 1)),
    cell: readNumberAtLeast(ring.cell, fallback.ring.cell, 0.1),
    maxRadius: readNumberAtLeast(ring.max_radius, fallback.ring.maxRadius, 0),
    ringDistance: readNumberAtLeast(ring.ring_distance, fallback.ring.ringDistance, 0),
    nearMeters: readNumberAtLeast(ring.near_meters, fallback.ring.nearMeters, 0),
    midMeters: readNumberAtLeast(ring.mid_meters, fallback.ring.midMeters, 0),
    farMeters: readNumberAtLeast(ring.far_meters, fallback.ring.farMeters, 0),
    farDistanceFraction: readNumberAtLeast(ring.far_distance_fraction, fallback.ring.farDistanceFraction, 0),
    bandMeters: readNumberAtLeast(ring.band_meters ?? lod.dither_band_m, fallback.ring.bandMeters, 0),
    scruffMeters: readNumberAtLeast(ring.scruff_meters, fallback.ring.scruffMeters, 0),
    scruffMinDensity: readFraction(ring.scruff_min_density, fallback.ring.scruffMinDensity),
  };
}

function buildSettings(raw: RawObject, fallback: GrassSettings, shaderMode: GrassShaderMode): GrassSettings {
  const placement = parsePlacement(raw, fallback);
  const lod = parseLod(raw, fallback);
  const blade = parseBlade(raw, fallback);
  const wind = parseWind(raw, fallback);
  const renderRoot = objectFrom(raw.render);
  const debugRoot = objectFrom(raw.debug);
  const patchRoot = objectFrom(raw.patch_fallback);
  const render = {
    alphaToCoverage: readBoolean(renderRoot.alpha_to_coverage ?? raw.alpha_to_coverage, fallback.render.alphaToCoverage),
    ditherFade: readBoolean(renderRoot.dither_fade, fallback.render.ditherFade),
  };
  const debug = {
    showLodColors: readBoolean(debugRoot.show_lod_colors, fallback.debug.showLodColors),
    showPatchBounds: readBoolean(debugRoot.show_patch_bounds, fallback.debug.showPatchBounds),
  };

  return {
    enabled: readBoolean(raw.enabled, fallback.enabled),
    shaderMode,
    distanceM: readNumberAtLeast(raw.patch_distance_m ?? raw.distance_m ?? raw.distance, fallback.distanceM, 0.1),
    refreshDistanceM: readNumberAtLeast(raw.refresh_distance_m ?? patchRoot.refresh_distance, fallback.refreshDistanceM, 0.1),
    maxNewPatchesPerFrame: readIntegerAtLeast(raw.max_new_patches_per_frame ?? patchRoot.max_new_patches_per_refresh, fallback.maxNewPatchesPerFrame, 1),
    maxInstances: readIntegerAtLeast(raw.max_instances_per_tier ?? raw.max_instances ?? raw.max_blades, fallback.maxInstances, 0),
    placement,
    lod,
    blade,
    wind,
    render,
    debug,
    alphaToCoverage: render.alphaToCoverage,
    nearCrossedQuads: blade.nearCrossedQuads,
    distance: readNumberAtLeast(raw.patch_distance_m ?? raw.distance_m ?? raw.distance, fallback.distance, 0.1),
    bladeSpacing: placement.spacingM,
    bladeHeight: blade.heightM,
    bladeHeightVariation: blade.heightVariation,
    bladeWidth: blade.widthM,
    windStrength: wind.strength,
    windSpeed: wind.speed,
    slopeMinY: placement.slopeMinY,
    minHeight: placement.minHeightM,
    maxHeight: placement.maxHeightM,
    maxBlades: readIntegerAtLeast(raw.max_instances_per_tier ?? raw.max_instances ?? raw.max_blades, fallback.maxBlades, 0),
    seed: Math.floor(readNumber(raw.seed, fallback.seed)),
    ring: parseRing(raw, fallback),
    patchFallback: {
      maxNewPatchesPerRefresh: readIntegerAtLeast(patchRoot.max_new_patches_per_refresh ?? raw.max_new_patches_per_frame, fallback.patchFallback.maxNewPatchesPerRefresh, 1),
      refreshDistance: readNumberAtLeast(patchRoot.refresh_distance ?? raw.refresh_distance_m, fallback.patchFallback.refreshDistance, 0.1),
    },
  };
}

function applyDefaultRuntimeBudget(settings: GrassSettings): GrassSettings {
  const budget = DEFAULT_GRASS_RUNTIME_BUDGET;
  return {
    ...settings,
    distanceM: Math.min(settings.distanceM, budget.distanceM),
    distance: Math.min(settings.distance, budget.distanceM),
    refreshDistanceM: Math.max(settings.refreshDistanceM, budget.refreshDistanceM),
    maxNewPatchesPerFrame: Math.min(settings.maxNewPatchesPerFrame, budget.maxNewPatchesPerFrame),
    maxInstances: Math.min(settings.maxInstances, budget.maxInstances),
    maxBlades: Math.min(settings.maxBlades, budget.maxInstances),
    ring: {
      ...settings.ring,
      grid: Math.min(settings.ring.grid, budget.ringGrid),
      cell: Math.max(settings.ring.cell, budget.ringCell),
      maxRadius: Math.min(settings.ring.maxRadius, budget.ringMaxRadius),
      ringDistance: Math.min(settings.ring.ringDistance, budget.ringDistance),
      nearMeters: Math.min(settings.ring.nearMeters, budget.ringNearMeters),
      midMeters: Math.min(settings.ring.midMeters, budget.ringMidMeters),
      farMeters: Math.min(settings.ring.farMeters, budget.ringFarMeters),
    },
    patchFallback: {
      ...settings.patchFallback,
      refreshDistance: Math.max(settings.patchFallback.refreshDistance, budget.refreshDistanceM),
      maxNewPatchesPerRefresh: Math.min(settings.patchFallback.maxNewPatchesPerRefresh, budget.maxNewPatchesPerFrame),
    },
  };
}

export function parseGrassConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): GrassSettings {
  const fallback = cloneGrassSettings();
  if (!text || text.trim() === "") return applyDefaultRuntimeBudget(fallback);

  const raw = readYamlGrass(text, warn);
  if (!raw) return applyDefaultRuntimeBudget(fallback);

  const shaderMode = readShaderMode(raw, fallback, warn);
  return resolveGrassSettings(applyDefaultRuntimeBudget(buildSettings(raw, fallback, shaderMode)));
}
