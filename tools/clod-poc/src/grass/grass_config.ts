import * as THREE from "three";
import { load } from "js-yaml";

export const TWO_PI = Math.PI * 2;
export const GRASS_SHADER_MODES = ["terrain-patch-v2", "webgpu-ring-v1", "classic"] as const;
export type GrassShaderMode = typeof GRASS_SHADER_MODES[number];
export const DEFAULT_GRASS_SHADER_MODE: GrassShaderMode = "webgpu-ring-v1";
export type GrassTier = "near" | "mid" | "far" | "super";
export const GRASS_WATER_CLEARANCE = 0.18;
export const MIN_GRASS_WEIGHT = 0.05;
export const BLADE_ROWS = [
  [0, 1],
  [0.35, 0.75],
  [0.7, 0.4],
  [1, 0],
] as const;
export const V2_NEAR_BLADE_ROWS = [
  [0, 1],
  [0.55, 0.6],
  [1, 0],
] as const;
export const V2_MID_BLADE_ROWS = [
  [0, 0.78],
  [1, 0],
] as const;
export const V2_NEAR_DISTANCE_FRACTION = 0.42;
export const V2_MID_DISTANCE_FRACTION = 0.78;
export const V2_MID_INSTANCE_FRACTION = 0.35;
export const V2_FAR_INSTANCE_FRACTION = 0.12;
export const V2_SUPER_INSTANCE_FRACTION = 0.045;
export const V2_EDGE_SAMPLE_SCALE = 1.25;
export const V2_EDGE_HEIGHT_SOFT = 1.5;
export const V2_EDGE_HEIGHT_HARD = 4.5;
export const RING_MAX_AXIS_CELLS = 220;

export type GrassBladeRows = readonly (readonly [number, number])[];

export interface GrassPlacementSettings {
  spacingM: number;
  jitter: number;
  slopeMinY: number;
  minHeightM: number;
  maxHeightM: number;
  minGrassWeight: number;
}

export interface GrassLodSettings {
  nearFraction: number;
  midFraction: number;
  farDensityRatio: number;
  midInstanceFraction: number;
  farInstanceFraction: number;
  ditherBandM: number;
}

export interface GrassBladeSettings {
  heightM: number;
  heightVariation: number;
  widthM: number;
  nearBladesPerInstance: number;
  midBladesPerInstance: number;
  nearSegments: number;
  midSegments: number;
  farTuftWidthM: number;
  nearCrossedQuads: boolean;
  maxWidthCompensation: number;
}

export interface GrassWindSettings {
  direction: [number, number];
  strength: number;
  speed: number;
  gustStrength: number;
}

export interface GrassRenderSettings {
  alphaToCoverage: boolean;
  ditherFade: boolean;
}

export interface GrassDebugSettings {
  showLodColors: boolean;
  showPatchBounds: boolean;
}

export interface GrassRingSettings {
  grid: number;
  cell: number;
  maxRadius: number;
  nearMeters: number;
  midMeters: number;
  farMeters: number;
  farDistanceFraction: number;
  bandMeters: number;
  scruffMeters: number;
}

export interface GrassPatchFallbackSettings {
  maxNewPatchesPerRefresh: number;
  refreshDistance: number;
}

export interface GrassSettings {
  enabled: boolean;
  shaderMode: GrassShaderMode;
  distanceM: number;
  refreshDistanceM: number;
  maxNewPatchesPerFrame: number;
  maxInstances: number;
  placement: GrassPlacementSettings;
  lod: GrassLodSettings;
  blade: GrassBladeSettings;
  wind: GrassWindSettings;
  render: GrassRenderSettings;
  debug: GrassDebugSettings;
  alphaToCoverage: boolean;
  nearCrossedQuads: boolean;
  distance: number;
  bladeSpacing: number;
  bladeHeight: number;
  bladeHeightVariation: number;
  bladeWidth: number;
  windStrength: number;
  windSpeed: number;
  slopeMinY: number;
  minHeight: number;
  maxHeight: number;
  maxBlades: number;
  seed: number;
  ring: GrassRingSettings;
  patchFallback: GrassPatchFallbackSettings;
}

export interface GrassLighting {
  light: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface GrassCandidateSample {
  height: number;
  normalY: number;
  grassWeight: number;
  threshold: number;
  waterDepth?: number;
  rockWeight?: number;
  snowWeight?: number;
}

export interface GrassTerrainSite {
  height: number;
  normalY: number;
  terrainNormal: [number, number, number];
  materialWeights: [number, number, number, number];
  grassMask: number;
  grassWeight: number;
  rockWeight: number;
  sandWeight: number;
  snowWeight: number;
  wetBank: number;
  waterDepth: number;
  slopeMask: number;
}

export const DEFAULT_GRASS_PLACEMENT_SETTINGS: GrassPlacementSettings = {
  spacingM: 1.45,
  jitter: 0.34,
  slopeMinY: 0.72,
  minHeightM: 12,
  maxHeightM: 28,
  minGrassWeight: 0.05,
};

export const DEFAULT_GRASS_LOD_SETTINGS: GrassLodSettings = {
  nearFraction: 0.42,
  midFraction: 0.78,
  farDensityRatio: 0.18,
  midInstanceFraction: 0.35,
  farInstanceFraction: 0.12,
  ditherBandM: 12,
};

export const DEFAULT_GRASS_BLADE_SETTINGS: GrassBladeSettings = {
  heightM: 1.15,
  heightVariation: 0.75,
  widthM: 0.08,
  nearBladesPerInstance: 5,
  midBladesPerInstance: 3,
  nearSegments: 4,
  midSegments: 2,
  farTuftWidthM: 0.28,
  nearCrossedQuads: true,
  maxWidthCompensation: 2.6,
};

export const DEFAULT_GRASS_WIND_SETTINGS: GrassWindSettings = {
  direction: [0.8, 0.6],
  strength: 0.32,
  speed: 1.35,
  gustStrength: 0.15,
};

export const DEFAULT_GRASS_RENDER_SETTINGS: GrassRenderSettings = {
  alphaToCoverage: false,
  ditherFade: true,
};

export const DEFAULT_GRASS_DEBUG_SETTINGS: GrassDebugSettings = {
  showLodColors: false,
  showPatchBounds: false,
};

export const DEFAULT_GRASS_RING_SETTINGS: GrassRingSettings = {
  grid: 700,
  cell: 0.7,
  maxRadius: 220,
  nearMeters: 36,
  midMeters: 110,
  farMeters: 170,
  farDistanceFraction: 0.94,
  bandMeters: DEFAULT_GRASS_LOD_SETTINGS.ditherBandM,
  scruffMeters: 24,
};

export const DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS: GrassPatchFallbackSettings = {
  maxNewPatchesPerRefresh: 2,
  refreshDistance: 4,
};

export const DEFAULT_GRASS_SETTINGS: GrassSettings = {
  enabled: true,
  shaderMode: DEFAULT_GRASS_SHADER_MODE,
  distanceM: 120,
  refreshDistanceM: DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS.refreshDistance,
  maxNewPatchesPerFrame: DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS.maxNewPatchesPerRefresh,
  maxInstances: 48000,
  placement: { ...DEFAULT_GRASS_PLACEMENT_SETTINGS },
  lod: { ...DEFAULT_GRASS_LOD_SETTINGS },
  blade: { ...DEFAULT_GRASS_BLADE_SETTINGS },
  wind: { ...DEFAULT_GRASS_WIND_SETTINGS },
  render: { ...DEFAULT_GRASS_RENDER_SETTINGS },
  debug: { ...DEFAULT_GRASS_DEBUG_SETTINGS },
  alphaToCoverage: DEFAULT_GRASS_RENDER_SETTINGS.alphaToCoverage,
  nearCrossedQuads: DEFAULT_GRASS_BLADE_SETTINGS.nearCrossedQuads,
  distance: 120,
  bladeSpacing: DEFAULT_GRASS_PLACEMENT_SETTINGS.spacingM,
  bladeHeight: DEFAULT_GRASS_BLADE_SETTINGS.heightM,
  bladeHeightVariation: DEFAULT_GRASS_BLADE_SETTINGS.heightVariation,
  bladeWidth: DEFAULT_GRASS_BLADE_SETTINGS.widthM,
  windStrength: DEFAULT_GRASS_WIND_SETTINGS.strength,
  windSpeed: DEFAULT_GRASS_WIND_SETTINGS.speed,
  slopeMinY: DEFAULT_GRASS_PLACEMENT_SETTINGS.slopeMinY,
  minHeight: DEFAULT_GRASS_PLACEMENT_SETTINGS.minHeightM,
  maxHeight: DEFAULT_GRASS_PLACEMENT_SETTINGS.maxHeightM,
  maxBlades: 48000,
  seed: 1337,
  ring: { ...DEFAULT_GRASS_RING_SETTINGS },
  patchFallback: { ...DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS },
};

export function isGrassShaderMode(value: unknown): value is GrassShaderMode {
  return typeof value === "string" && (GRASS_SHADER_MODES as readonly string[]).includes(value);
}

interface GrassYamlConfig {
  grass?: {
    enabled?: boolean;
    shader_mode?: unknown;
    distance_m?: number;
    refresh_distance_m?: number;
    max_new_patches_per_frame?: number;
    max_instances?: number;
    placement?: {
      spacing_m?: number;
      jitter?: number;
      slope_min_y?: number;
      min_height_m?: number;
      max_height_m?: number;
      min_grass_weight?: number;
    };
    lod?: {
      near_fraction?: number;
      mid_fraction?: number;
      far_density_ratio?: number;
      mid_instance_fraction?: number;
      far_instance_fraction?: number;
      dither_band_m?: number;
    };
    blade?: {
      height_m?: number;
      height_variation?: number;
      width_m?: number;
      near_blades_per_instance?: number;
      mid_blades_per_instance?: number;
      near_segments?: number;
      mid_segments?: number;
      far_tuft_width_m?: number;
      near_crossed_quads?: boolean;
      max_width_compensation?: number;
    };
    wind?: {
      direction?: unknown;
      strength?: number;
      speed?: number;
      gust_strength?: number;
    };
    render?: {
      alpha_to_coverage?: boolean;
      dither_fade?: boolean;
    };
    debug?: {
      show_lod_colors?: boolean;
      show_patch_bounds?: boolean;
    };
    alpha_to_coverage?: boolean;
    near_crossed_quads?: boolean;
    distance?: number;
    blade_spacing?: number;
    blade_height?: number;
    blade_height_variation?: number;
    blade_width?: number;
    wind_strength?: number;
    wind_speed?: number;
    slope_min_y?: number;
    min_height?: number;
    max_height?: number;
    max_blades?: number;
    seed?: number;
    ring?: {
      grid?: number;
      cell?: number;
      max_radius?: number;
      near_meters?: number;
      mid_meters?: number;
      far_meters?: number;
      far_distance_fraction?: number;
      band_meters?: number;
      scruff_meters?: number;
    };
    patch_fallback?: {
      max_new_patches_per_refresh?: number;
      refresh_distance?: number;
    };
  };
}

export function cloneGrassSettings(settings: GrassSettings = DEFAULT_GRASS_SETTINGS): GrassSettings {
  return {
    ...settings,
    placement: { ...settings.placement },
    lod: { ...settings.lod },
    blade: { ...settings.blade },
    wind: { ...settings.wind, direction: [...settings.wind.direction] },
    render: { ...settings.render },
    debug: { ...settings.debug },
    ring: { ...settings.ring },
    patchFallback: { ...settings.patchFallback },
  };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNumberAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

function readFraction(value: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, readNumber(value, fallback)));
}

function readIntegerAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, Math.floor(readNumber(value, fallback)));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readWindDirection(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return [...fallback];
  const x = readNumber(value[0], Number.NaN);
  const z = readNumber(value[1], Number.NaN);
  const len = Math.hypot(x, z);
  if (!Number.isFinite(len) || len < 1e-5) return [...fallback];
  return [x / len, z / len];
}

function warnGrassConfig(message: string, warn?: (message: string) => void): void {
  warn?.(`[grass-config] ${message}`);
}

export function grassRowsForSegments(segments: number, tipHalfWidth = 0): GrassBladeRows {
  const count = Math.max(1, Math.floor(segments));
  const rows: [number, number][] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const halfWidth = THREE.MathUtils.lerp(1, tipHalfWidth, Math.pow(t, 1.35));
    rows.push([t, halfWidth]);
  }
  return rows;
}

export function resolveGrassSettings(settings: GrassSettings): GrassSettings {
  const distanceM = readNumberAtLeast(settings.distanceM ?? settings.distance, DEFAULT_GRASS_SETTINGS.distanceM, 0.1);
  const maxInstances = readIntegerAtLeast(settings.maxInstances ?? settings.maxBlades, DEFAULT_GRASS_SETTINGS.maxInstances, 1);
  const refreshDistanceM = readNumberAtLeast(
    settings.refreshDistanceM ?? settings.patchFallback?.refreshDistance,
    DEFAULT_GRASS_SETTINGS.refreshDistanceM,
    0.1,
  );
  const maxNewPatchesPerFrame = readIntegerAtLeast(
    settings.maxNewPatchesPerFrame ?? settings.patchFallback?.maxNewPatchesPerRefresh,
    DEFAULT_GRASS_SETTINGS.maxNewPatchesPerFrame,
    1,
  );
  const placement = {
    ...DEFAULT_GRASS_PLACEMENT_SETTINGS,
    ...settings.placement,
  };
  placement.spacingM = readNumberAtLeast(placement.spacingM ?? settings.bladeSpacing, DEFAULT_GRASS_PLACEMENT_SETTINGS.spacingM, 0.05);
  placement.jitter = readFraction(placement.jitter, DEFAULT_GRASS_PLACEMENT_SETTINGS.jitter);
  placement.slopeMinY = readFraction(placement.slopeMinY ?? settings.slopeMinY, DEFAULT_GRASS_PLACEMENT_SETTINGS.slopeMinY);
  placement.minHeightM = readNumber(placement.minHeightM ?? settings.minHeight, DEFAULT_GRASS_PLACEMENT_SETTINGS.minHeightM);
  placement.maxHeightM = readNumber(placement.maxHeightM ?? settings.maxHeight, DEFAULT_GRASS_PLACEMENT_SETTINGS.maxHeightM);
  placement.minGrassWeight = readFraction(placement.minGrassWeight, DEFAULT_GRASS_PLACEMENT_SETTINGS.minGrassWeight);
  if (placement.maxHeightM < placement.minHeightM) placement.maxHeightM = placement.minHeightM;

  const lod = {
    ...DEFAULT_GRASS_LOD_SETTINGS,
    ...settings.lod,
  };
  lod.nearFraction = readFraction(lod.nearFraction, DEFAULT_GRASS_LOD_SETTINGS.nearFraction);
  lod.midFraction = readFraction(lod.midFraction, DEFAULT_GRASS_LOD_SETTINGS.midFraction);
  if (lod.midFraction <= lod.nearFraction) lod.midFraction = Math.min(1, lod.nearFraction + 0.01);
  lod.farDensityRatio = readFraction(lod.farDensityRatio, DEFAULT_GRASS_LOD_SETTINGS.farDensityRatio);
  lod.midInstanceFraction = readFraction(lod.midInstanceFraction, DEFAULT_GRASS_LOD_SETTINGS.midInstanceFraction);
  lod.farInstanceFraction = readFraction(lod.farInstanceFraction, DEFAULT_GRASS_LOD_SETTINGS.farInstanceFraction);
  lod.ditherBandM = readNumberAtLeast(lod.ditherBandM, DEFAULT_GRASS_LOD_SETTINGS.ditherBandM, 0);

  const blade = {
    ...DEFAULT_GRASS_BLADE_SETTINGS,
    ...settings.blade,
  };
  blade.heightM = readNumberAtLeast(blade.heightM ?? settings.bladeHeight, DEFAULT_GRASS_BLADE_SETTINGS.heightM, 0.05);
  blade.heightVariation = readNumberAtLeast(blade.heightVariation ?? settings.bladeHeightVariation, DEFAULT_GRASS_BLADE_SETTINGS.heightVariation, 0);
  blade.widthM = readNumberAtLeast(blade.widthM ?? settings.bladeWidth, DEFAULT_GRASS_BLADE_SETTINGS.widthM, 0.001);
  blade.nearBladesPerInstance = readIntegerAtLeast(blade.nearBladesPerInstance, DEFAULT_GRASS_BLADE_SETTINGS.nearBladesPerInstance, 1);
  blade.midBladesPerInstance = readIntegerAtLeast(blade.midBladesPerInstance, DEFAULT_GRASS_BLADE_SETTINGS.midBladesPerInstance, 1);
  blade.nearSegments = readIntegerAtLeast(blade.nearSegments, DEFAULT_GRASS_BLADE_SETTINGS.nearSegments, 1);
  blade.midSegments = readIntegerAtLeast(blade.midSegments, DEFAULT_GRASS_BLADE_SETTINGS.midSegments, 1);
  blade.farTuftWidthM = readNumberAtLeast(blade.farTuftWidthM, DEFAULT_GRASS_BLADE_SETTINGS.farTuftWidthM, 0.01);
  blade.nearCrossedQuads = readBoolean(blade.nearCrossedQuads ?? settings.nearCrossedQuads, DEFAULT_GRASS_BLADE_SETTINGS.nearCrossedQuads);
  blade.maxWidthCompensation = readNumberAtLeast(blade.maxWidthCompensation, DEFAULT_GRASS_BLADE_SETTINGS.maxWidthCompensation, 1);

  const windDirection = readWindDirection(settings.wind?.direction, DEFAULT_GRASS_WIND_SETTINGS.direction);
  const wind = {
    ...DEFAULT_GRASS_WIND_SETTINGS,
    ...settings.wind,
    direction: windDirection,
  };
  wind.strength = readNumberAtLeast(wind.strength ?? settings.windStrength, DEFAULT_GRASS_WIND_SETTINGS.strength, 0);
  wind.speed = readNumberAtLeast(wind.speed ?? settings.windSpeed, DEFAULT_GRASS_WIND_SETTINGS.speed, 0);
  wind.gustStrength = readNumberAtLeast(wind.gustStrength, DEFAULT_GRASS_WIND_SETTINGS.gustStrength, 0);

  const render = {
    ...DEFAULT_GRASS_RENDER_SETTINGS,
    ...settings.render,
  };
  render.alphaToCoverage = readBoolean(render.alphaToCoverage ?? settings.alphaToCoverage, DEFAULT_GRASS_RENDER_SETTINGS.alphaToCoverage);
  render.ditherFade = readBoolean(render.ditherFade, DEFAULT_GRASS_RENDER_SETTINGS.ditherFade);

  const debug = {
    ...DEFAULT_GRASS_DEBUG_SETTINGS,
    ...settings.debug,
  };
  debug.showLodColors = readBoolean(debug.showLodColors, DEFAULT_GRASS_DEBUG_SETTINGS.showLodColors);
  debug.showPatchBounds = readBoolean(debug.showPatchBounds, DEFAULT_GRASS_DEBUG_SETTINGS.showPatchBounds);

  return {
    ...settings,
    distanceM,
    refreshDistanceM,
    maxNewPatchesPerFrame,
    maxInstances,
    placement,
    lod,
    blade,
    wind,
    render,
    debug,
    alphaToCoverage: render.alphaToCoverage,
    nearCrossedQuads: blade.nearCrossedQuads,
    distance: distanceM,
    bladeSpacing: placement.spacingM,
    bladeHeight: blade.heightM,
    bladeHeightVariation: blade.heightVariation,
    bladeWidth: blade.widthM,
    windStrength: wind.strength,
    windSpeed: wind.speed,
    slopeMinY: placement.slopeMinY,
    minHeight: placement.minHeightM,
    maxHeight: placement.maxHeightM,
    maxBlades: maxInstances,
    ring: {
      ...settings.ring,
      bandMeters: settings.ring.bandMeters,
      farDistanceFraction: settings.ring.farDistanceFraction,
    },
    patchFallback: {
      maxNewPatchesPerRefresh: maxNewPatchesPerFrame,
      refreshDistance: refreshDistanceM,
    },
  };
}

export function parseGrassConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): GrassSettings {
  const fallback = cloneGrassSettings();
  if (!text || text.trim() === "") return fallback;

  let rawConfig: GrassYamlConfig;
  try {
    rawConfig = (load(text) ?? {}) as GrassYamlConfig;
  } catch (error) {
    warnGrassConfig(`failed to parse config/grass.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`, warn ?? undefined);
    return fallback;
  }

  const raw = rawConfig.grass ?? {};
  let shaderMode = fallback.shaderMode;
  if (raw.shader_mode !== undefined) {
    if (isGrassShaderMode(raw.shader_mode)) shaderMode = raw.shader_mode;
    else warnGrassConfig(`invalid shader_mode "${String(raw.shader_mode)}"; using ${fallback.shaderMode}`, warn ?? undefined);
  }

  const placement = {
    spacingM: readNumberAtLeast(raw.placement?.spacing_m ?? raw.blade_spacing, fallback.placement.spacingM, 0.05),
    jitter: readFraction(raw.placement?.jitter, fallback.placement.jitter),
    slopeMinY: readFraction(raw.placement?.slope_min_y ?? raw.slope_min_y, fallback.placement.slopeMinY),
    minHeightM: readNumber(raw.placement?.min_height_m ?? raw.min_height, fallback.placement.minHeightM),
    maxHeightM: readNumber(raw.placement?.max_height_m ?? raw.max_height, fallback.placement.maxHeightM),
    minGrassWeight: readFraction(raw.placement?.min_grass_weight, fallback.placement.minGrassWeight),
  };
  const lod = {
    nearFraction: readFraction(raw.lod?.near_fraction, fallback.lod.nearFraction),
    midFraction: readFraction(raw.lod?.mid_fraction, fallback.lod.midFraction),
    farDensityRatio: readFraction(raw.lod?.far_density_ratio, fallback.lod.farDensityRatio),
    midInstanceFraction: readFraction(raw.lod?.mid_instance_fraction, fallback.lod.midInstanceFraction),
    farInstanceFraction: readFraction(raw.lod?.far_instance_fraction, fallback.lod.farInstanceFraction),
    ditherBandM: readNumberAtLeast(raw.lod?.dither_band_m, fallback.lod.ditherBandM, 0),
  };
  const blade = {
    heightM: readNumberAtLeast(raw.blade?.height_m ?? raw.blade_height, fallback.blade.heightM, 0.05),
    heightVariation: readNumberAtLeast(raw.blade?.height_variation ?? raw.blade_height_variation, fallback.blade.heightVariation, 0),
    widthM: readNumberAtLeast(raw.blade?.width_m ?? raw.blade_width, fallback.blade.widthM, 0.001),
    nearBladesPerInstance: readIntegerAtLeast(raw.blade?.near_blades_per_instance, fallback.blade.nearBladesPerInstance, 1),
    midBladesPerInstance: readIntegerAtLeast(raw.blade?.mid_blades_per_instance, fallback.blade.midBladesPerInstance, 1),
    nearSegments: readIntegerAtLeast(raw.blade?.near_segments, fallback.blade.nearSegments, 1),
    midSegments: readIntegerAtLeast(raw.blade?.mid_segments, fallback.blade.midSegments, 1),
    farTuftWidthM: readNumberAtLeast(raw.blade?.far_tuft_width_m, fallback.blade.farTuftWidthM, 0.01),
    nearCrossedQuads: readBoolean(raw.blade?.near_crossed_quads ?? raw.near_crossed_quads, fallback.blade.nearCrossedQuads),
    maxWidthCompensation: readNumberAtLeast(raw.blade?.max_width_compensation, fallback.blade.maxWidthCompensation, 1),
  };
  const wind = {
    direction: readWindDirection(raw.wind?.direction, fallback.wind.direction),
    strength: readNumberAtLeast(raw.wind?.strength ?? raw.wind_strength, fallback.wind.strength, 0),
    speed: readNumberAtLeast(raw.wind?.speed ?? raw.wind_speed, fallback.wind.speed, 0),
    gustStrength: readNumberAtLeast(raw.wind?.gust_strength, fallback.wind.gustStrength, 0),
  };
  const render = {
    alphaToCoverage: readBoolean(raw.render?.alpha_to_coverage ?? raw.alpha_to_coverage, fallback.render.alphaToCoverage),
    ditherFade: readBoolean(raw.render?.dither_fade, fallback.render.ditherFade),
  };
  const debug = {
    showLodColors: readBoolean(raw.debug?.show_lod_colors, fallback.debug.showLodColors),
    showPatchBounds: readBoolean(raw.debug?.show_patch_bounds, fallback.debug.showPatchBounds),
  };
  const parsed: GrassSettings = {
    enabled: readBoolean(raw.enabled, fallback.enabled),
    shaderMode,
    distanceM: readNumberAtLeast(raw.distance_m ?? raw.distance, fallback.distanceM, 0.1),
    refreshDistanceM: readNumberAtLeast(raw.refresh_distance_m ?? raw.patch_fallback?.refresh_distance, fallback.refreshDistanceM, 0.1),
    maxNewPatchesPerFrame: readIntegerAtLeast(
      raw.max_new_patches_per_frame ?? raw.patch_fallback?.max_new_patches_per_refresh,
      fallback.maxNewPatchesPerFrame,
      1,
    ),
    maxInstances: readIntegerAtLeast(raw.max_instances ?? raw.max_blades, fallback.maxInstances, 0),
    placement,
    lod,
    blade,
    wind,
    render,
    debug,
    alphaToCoverage: render.alphaToCoverage,
    nearCrossedQuads: blade.nearCrossedQuads,
    distance: readNumberAtLeast(raw.distance_m ?? raw.distance, fallback.distance, 0.1),
    bladeSpacing: placement.spacingM,
    bladeHeight: blade.heightM,
    bladeHeightVariation: blade.heightVariation,
    bladeWidth: blade.widthM,
    windStrength: wind.strength,
    windSpeed: wind.speed,
    slopeMinY: placement.slopeMinY,
    minHeight: placement.minHeightM,
    maxHeight: placement.maxHeightM,
    maxBlades: readIntegerAtLeast(raw.max_instances ?? raw.max_blades, fallback.maxBlades, 0),
    seed: Math.floor(readNumber(raw.seed, fallback.seed)),
    ring: {
      grid: Math.floor(readNumberAtLeast(raw.ring?.grid, fallback.ring.grid, 1)),
      cell: readNumberAtLeast(raw.ring?.cell, fallback.ring.cell, 0.1),
      maxRadius: readNumberAtLeast(raw.ring?.max_radius, fallback.ring.maxRadius, 0),
      nearMeters: readNumberAtLeast(raw.ring?.near_meters, fallback.ring.nearMeters, 0),
      midMeters: readNumberAtLeast(raw.ring?.mid_meters, fallback.ring.midMeters, 0),
      farMeters: readNumberAtLeast(raw.ring?.far_meters, fallback.ring.farMeters, 0),
      farDistanceFraction: readNumberAtLeast(raw.ring?.far_distance_fraction, fallback.ring.farDistanceFraction, 0),
      bandMeters: readNumberAtLeast(raw.ring?.band_meters ?? raw.lod?.dither_band_m, fallback.ring.bandMeters, 0),
      scruffMeters: readNumberAtLeast(raw.ring?.scruff_meters, fallback.ring.scruffMeters, 0),
    },
    patchFallback: {
      maxNewPatchesPerRefresh: readIntegerAtLeast(
        raw.patch_fallback?.max_new_patches_per_refresh ?? raw.max_new_patches_per_frame,
        fallback.patchFallback.maxNewPatchesPerRefresh,
        1,
      ),
      refreshDistance: readNumberAtLeast(raw.patch_fallback?.refresh_distance ?? raw.refresh_distance_m, fallback.patchFallback.refreshDistance, 0.1),
    },
  };
  return resolveGrassSettings(parsed);
}
