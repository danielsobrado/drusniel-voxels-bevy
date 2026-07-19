import type * as THREE from "three";

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
  /** Perpendicular turbulence amplitude relative to the primary wave (0..1). */
  turbulence?: number;
}

export interface GrassAppearanceSettings {
  /** Linear RGB. Shared with the terrain meadow color so blade roots match the soil. */
  baseColor: [number, number, number];
  tipColor: [number, number, number];
  dryColor: [number, number, number];
  /** 0..1 blend of the shading normal toward the terrain normal over the whole blade. */
  normalPull: number;
  /** Dry/lush patch noise wavelength in meters (ring compute side). */
  patchScale: number;
  /** 0..1 contribution of the patch noise to the dry color mix. */
  patchStrength: number;
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
  ringDistance: number;
  nearMeters: number;
  midMeters: number;
  farMeters: number;
  farDistanceFraction: number;
  bandMeters: number;
  scruffMeters: number;
  scruffMinDensity: number;
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
  appearance?: GrassAppearanceSettings;
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
