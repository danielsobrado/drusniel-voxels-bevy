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
  suspendedScatter: 15,
  farReflectionHit: 16,
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
  enabled: boolean;
  lakeStrength: number;
  riverStrength: number;
  absorptionMultiplier: [number, number, number];
  turbidityAdd: number;
  reflectionDampingMin: number;
}

export interface WaterRockFlourConfig {
  enabled: boolean;
  lakeStrength: number;
  riverStrength: number;
  lakeColor: [number, number, number];
  riverColor: [number, number, number];
  shallowBlend: number;
  deepBlend: number;
  scatterExtinction: number;
  scatterStrength: number;
  scatterAmbient: number;
}

export interface WaterGlitterConfig {
  enabled: boolean;
  tightExponent: number;
  tightGain: number;
  broadExponent: number;
  broadGain: number;
  lowSunGain: number;
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
  bodies: WaterBodyVisualPresets;
  glacialMurkiness: WaterGlacialMurkinessConfig;
  rockFlour: WaterRockFlourConfig;
  glitter: WaterGlitterConfig;
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
  shoreDistanceStart: number;
  shoreDistanceEnd: number;
  detailFadeStartM: number;
  detailFadeEndM: number;
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

export interface WaterReflectionClipmapTiersConfig {
  enabled: boolean;
  fullQualityMaxCellSizeM: number;
  midQualityMaxCellSizeM: number;
  midMaxSteps: number;
}

export interface WaterFarSummaryReflectionConfig {
  enabled: boolean;
  sourceResolution: number;
  sourceSpanM: number;
  sourceSnapM: number;
  sourceBuildCellsPerFrame: number;
  maxSteps: number;
  startDistanceM: number;
  maxDistanceM: number;
  stepGrowth: number;
  thicknessM: number;
  terrainStrength: number;
  propStrength: number;
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
  clipmapTiers: WaterReflectionClipmapTiersConfig;
  farSummary: WaterFarSummaryReflectionConfig;
}

export interface WaterConfig {
  enabled: boolean;
  source: "hydrology" | "fake_bodies";
  cellsPerLevel: number;
  cellSizes: number[];
  snapCells: number;
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
