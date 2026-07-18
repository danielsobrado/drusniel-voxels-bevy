import type { CausticsConfig } from "./causticsConfig.js";
import type { HydrologyConfig } from "./hydrologyConfig.js";

/** Debug render modes for the water material. */
export const WATER_DEBUG_MODES = {
  final: 0,
  depth: 1,
  foam: 2,
  fresnel: 3,
  bodyMask: 4,
  clipmapLevel: 5,
  flow: 6,
  hydrologyFill: 7,
  accumulation: 8,
  carvedBed: 9,
  waterY: 10,
  classification: 11,
  refraction: 12,
  reflection: 13,
  ssrHit: 14,
} as const;

export type WaterDebugMode = keyof typeof WATER_DEBUG_MODES;
export type WaterDebugModeId = typeof WATER_DEBUG_MODES[WaterDebugMode];

export interface LakeBodyConfig {
  center: [number, number];
  centerNorm?: [number, number];
  radius: [number, number];
  levelOffset: number;
}

export interface RiverBodyConfig {
  points: Array<[number, number]>;
  pointsNorm?: Array<[number, number]>;
  width: number;
  levelOffset: number;
  downstreamDrop: number;
}

import type { WaterBodyVisualPresets } from "./water_body_presets.js";

export interface WaterGlacialMurkinessConfig {
  /** Kill switch. Disabled configurations preserve the original body preset objects. */
  enabled: boolean;
  /** Fraction of the shared glacial-murkiness state applied to lakes. */
  lakeStrength: number;
  /** Fraction of the shared glacial-murkiness state applied to rivers. */
  riverStrength: number;
  /** Full-strength RGB Beer-Lambert multiplier. */
  absorptionMultiplier: [number, number, number];
  /** Full-strength turbidity added to the base body preset. */
  turbidityAdd: number;
  /** Lower bound approached by reflection damping at full strength. */
  reflectionDampingMin: number;
}

export interface WaterVisualConfig {
  shallowColor: [number, number, number];
  deepColor: [number, number, number];
  foamColor: [number, number, number];
  alpha: number;
  rippleCycle: number;
  fresnelPower: number;
  rippleAmp: number;
  rippleSpeed: number;
  rippleScaleA: number;
  rippleScaleB: number;
  rippleStrengthA: number;
  rippleStrengthB: number;
  rippleLoopDistance: number;
  lakeBreeze: [number, number];
  shoreFoamStart: number;
  shoreFoamEnd: number;
  maxDepthForColor: number;
  foam: WaterFoamVisualConfig;
  fresnel: WaterFresnelVisualConfig;
  color: WaterColorVisualConfig;
  /** Per-body-kind colour/absorption/turbidity/reflection presets (Phase 7b). */
  bodies: WaterBodyVisualPresets;
  /** Optional biome-state multiplier over existing lake/river optical presets. */
  glacialMurkiness: WaterGlacialMurkinessConfig;
  refraction: WaterRefractionConfig;
  reflection: WaterReflectionConfig;
  depthWrite: boolean;
}

export interface WaterDebugConfig {
  mode: WaterDebugModeId;
  clipmapTint: boolean;
  wireframe: boolean;
}

export interface WaterFoamVisualConfig {
  noiseScale: number;
  shoreStrength: number;
  riverStrength: number;
  speedStart: number;
  speedEnd: number;
  dropStart: number;
  dropEnd: number;
  /** Shore foam band in metres-to-shoreline (hydrology shoreDistance); complements the
   *  depth-based band, which stays as the fallback where shoreDistance is unavailable. */
  shoreDistanceStart: number;
  shoreDistanceEnd: number;
}

export interface WaterFresnelVisualConfig {
  base: number;
  power: number;
  normalFlatten: number;
}

export interface WaterColorVisualConfig {
  depthScale: number;
  turbidity: number;
}

export interface WaterRefractionConfig {
  enabled: boolean;
  strength: number;
  depthValidationBias: number;
  absorptionR: number;
  absorptionG: number;
  absorptionB: number;
  turbidityStrength: number;
  maxThickness: number;
}

export interface WaterReflectionConfig {
  mode: "fake" | "ssr";
  ssrEnabled: boolean;
  maxSteps: number;
  stepScale: number;
  edgeFadeStart: number;
  edgeFadeEnd: number;
  skyFallbackStrength: number;
  terrainFallbackStrength: number;
}

export interface WaterConfig {
  enabled: boolean;
  source: "hydrology" | "fake_bodies";
  cellsPerLevel: number;
  cellSizes: number[];
  snapCells: number;
  /** Offer static clipmap topology to materials that support it (Phase 5b): per-level
   *  toroidal texel textures + a fixed index buffer, so snaps stop rebuilding indices
   *  and re-uploading vertex buffers. false forces the legacy CPU vertex-buffer path. */
  staticTopology: boolean;
  drySentinelDepth: number;
  fakeBodies: {
    carveTerrain: boolean;
    lakes: LakeBodyConfig[];
    rivers: RiverBodyConfig[];
  };
  hydrology: HydrologyConfig;
  visual: WaterVisualConfig;
  caustics: CausticsConfig;
  debug: WaterDebugConfig;
}
