import type * as THREE from "three";
import { load } from "js-yaml";

export const TWO_PI = Math.PI * 2;
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
export const GRASS_SHADER_MODES = ["terrain-patch-v2", "webgpu-ring-v1", "classic"] as const;
export type GrassShaderMode = typeof GRASS_SHADER_MODES[number];
export const DEFAULT_GRASS_SHADER_MODE: GrassShaderMode = "webgpu-ring-v1";
export type GrassTier = "near" | "mid" | "far" | "super";
export const V2_NEAR_DISTANCE_FRACTION = 0.42;
export const V2_MID_DISTANCE_FRACTION = 0.78;
export const V2_MID_INSTANCE_FRACTION = 0.35;
export const V2_FAR_INSTANCE_FRACTION = 0.12;
export const V2_SUPER_INSTANCE_FRACTION = 0.045;
export const V2_EDGE_SAMPLE_SCALE = 1.25;
export const V2_EDGE_HEIGHT_SOFT = 1.5;
export const V2_EDGE_HEIGHT_HARD = 4.5;
export const PATCH_REFRESH_DISTANCE = 4;
export const RING_MAX_RADIUS = 220;
export const RING_MAX_AXIS_CELLS = 220;
export const RING_NEAR_METERS = 36;
export const RING_MID_METERS = 110;
export const RING_FAR_METERS = 170;
export const RING_FAR_DISTANCE_FRACTION = 0.94;
export const RING_BAND_METERS = 12;
export const RING_SCRUFF_METERS = 24;
export const GRASS_WATER_CLEARANCE = 0.18;
// Max new grass patches (scatter + InstancedBufferGeometry build) per refreshPatches call. Caps
// the per-frame cost so walking across page boundaries doesn't scatter many patches in one frame;
// the rest build over the next frames via patchesDirty. Trade: grass fills in over a few frames.
export const MAX_NEW_PATCHES_PER_REFRESH = 2;

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

export const DEFAULT_GRASS_RING_SETTINGS: GrassRingSettings = {
  grid: 700,
  cell: 0.7,
  maxRadius: RING_MAX_RADIUS,
  nearMeters: RING_NEAR_METERS,
  midMeters: RING_MID_METERS,
  farMeters: RING_FAR_METERS,
  farDistanceFraction: RING_FAR_DISTANCE_FRACTION,
  bandMeters: RING_BAND_METERS,
  scruffMeters: RING_SCRUFF_METERS,
};

export const DEFAULT_GRASS_PATCH_FALLBACK_SETTINGS: GrassPatchFallbackSettings = {
  maxNewPatchesPerRefresh: MAX_NEW_PATCHES_PER_REFRESH,
  refreshDistance: PATCH_REFRESH_DISTANCE,
};

export const DEFAULT_GRASS_SETTINGS: GrassSettings = {
  enabled: false,
  shaderMode: DEFAULT_GRASS_SHADER_MODE,
  alphaToCoverage: false,
  nearCrossedQuads: true,
  distance: 96,
  bladeSpacing: 1.6,
  bladeHeight: 1.15,
  bladeHeightVariation: 0.75,
  bladeWidth: 0.08,
  windStrength: 0.32,
  windSpeed: 1.35,
  slopeMinY: 0.72,
  minHeight: 12,
  maxHeight: 128,
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

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function warnGrassConfig(message: string, warn?: (message: string) => void): void {
  warn?.(`[grass-config] ${message}`);
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

  return {
    enabled: readBoolean(raw.enabled, fallback.enabled),
    shaderMode,
    alphaToCoverage: readBoolean(raw.alpha_to_coverage, fallback.alphaToCoverage),
    nearCrossedQuads: readBoolean(raw.near_crossed_quads, fallback.nearCrossedQuads),
    distance: readNumber(raw.distance, fallback.distance),
    bladeSpacing: readNumber(raw.blade_spacing, fallback.bladeSpacing),
    bladeHeight: readNumber(raw.blade_height, fallback.bladeHeight),
    bladeHeightVariation: readNumber(raw.blade_height_variation, fallback.bladeHeightVariation),
    bladeWidth: readNumber(raw.blade_width, fallback.bladeWidth),
    windStrength: readNumber(raw.wind_strength, fallback.windStrength),
    windSpeed: readNumber(raw.wind_speed, fallback.windSpeed),
    slopeMinY: readNumber(raw.slope_min_y, fallback.slopeMinY),
    minHeight: readNumber(raw.min_height, fallback.minHeight),
    maxHeight: readNumber(raw.max_height, fallback.maxHeight),
    maxBlades: Math.floor(readNumberAtLeast(raw.max_blades, fallback.maxBlades, 0)),
    seed: Math.floor(readNumber(raw.seed, fallback.seed)),
    ring: {
      grid: Math.floor(readNumberAtLeast(raw.ring?.grid, fallback.ring.grid, 1)),
      cell: readNumberAtLeast(raw.ring?.cell, fallback.ring.cell, 0.1),
      maxRadius: readNumberAtLeast(raw.ring?.max_radius, fallback.ring.maxRadius, 0),
      nearMeters: readNumberAtLeast(raw.ring?.near_meters, fallback.ring.nearMeters, 0),
      midMeters: readNumberAtLeast(raw.ring?.mid_meters, fallback.ring.midMeters, 0),
      farMeters: readNumberAtLeast(raw.ring?.far_meters, fallback.ring.farMeters, 0),
      farDistanceFraction: readNumberAtLeast(raw.ring?.far_distance_fraction, fallback.ring.farDistanceFraction, 0),
      bandMeters: readNumberAtLeast(raw.ring?.band_meters, fallback.ring.bandMeters, 0),
      scruffMeters: readNumberAtLeast(raw.ring?.scruff_meters, fallback.ring.scruffMeters, 0),
    },
    patchFallback: {
      maxNewPatchesPerRefresh: Math.floor(readNumberAtLeast(
        raw.patch_fallback?.max_new_patches_per_refresh,
        fallback.patchFallback.maxNewPatchesPerRefresh,
        1,
      )),
      refreshDistance: readNumberAtLeast(raw.patch_fallback?.refresh_distance, fallback.patchFallback.refreshDistance, 0.1),
    },
  };
}
