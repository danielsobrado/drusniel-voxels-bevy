import type * as THREE from "three";

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
export const RING_SCRUFF_METERS = 24;
export const GRASS_WATER_CLEARANCE = 0.18;
// Max new grass patches (scatter + InstancedBufferGeometry build) per refreshPatches call. Caps
// the per-frame cost so walking across page boundaries doesn't scatter many patches in one frame;
// the rest build over the next frames via patchesDirty. Trade: grass fills in over a few frames.
export const MAX_NEW_PATCHES_PER_REFRESH = 2;

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

export const DEFAULT_GRASS_SETTINGS: GrassSettings = {
  enabled: true,
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
};

export function isGrassShaderMode(value: unknown): value is GrassShaderMode {
  return typeof value === "string" && (GRASS_SHADER_MODES as readonly string[]).includes(value);
}

