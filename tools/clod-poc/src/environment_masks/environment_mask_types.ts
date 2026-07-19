import type { EnvironmentQueryMeta } from "../environment_query/types.js";

export const ENVIRONMENTAL_MASK_NAMES = [
  "riverCobble",
  "riverMist",
  "rapidSplash",
  "sunbeamMote",
  "calmPool",
  "frost",
  "dew",
  "shoreDebris",
] as const;

export type EnvironmentalMaskName = (typeof ENVIRONMENTAL_MASK_NAMES)[number];

export interface EnvironmentalBandSettings {
  enabled: boolean;
  strength: number;
}

export interface RiverCobbleMaskSettings extends EnvironmentalBandSettings {
  minDepthM: number;
  maxDepthM: number;
  minFlowStrength: number;
  maxFlowStrength: number;
  maxShoreDistanceM: number;
  minNormalY: number;
}

export interface RiverMistParticleSettings {
  spawnRadiusM: number;
  spacingM: number;
  sampleHintM: number;
  emitIntervalS: number;
  maxParticles: number;
  maxEmittersPerTick: number;
  scanCellsPerFrame: number;
  pointSizeM: number;
  opacity: number;
  spawnProbability: number;
  riseSpeedMps: number;
  driftSpeedMps: number;
  minLifetimeS: number;
  maxLifetimeS: number;
  surfaceOffsetM: number;
  colorRgb: [number, number, number];
}

export interface RiverMistMaskSettings extends EnvironmentalBandSettings {
  minFlowStrength: number;
  maxShoreDistanceM: number;
  particles: RiverMistParticleSettings;
}

export interface RapidSplashMaskSettings extends EnvironmentalBandSettings {
  flowStart: number;
  flowEnd: number;
  bedDropStart: number;
  bedDropEnd: number;
}

export interface SunbeamMoteParticleSettings {
  maxParticles: number;
  spawnRadiusM: number;
  fadeStartM: number;
  fadeEndM: number;
  updatePeriodFrames: number;
  density: number;
  opacity: number;
  forwardScatterPower: number;
  mistFloor: number;
  warmColorRgb: [number, number, number];
  coldColorRgb: [number, number, number];
}

export interface SunbeamMoteMaskSettings extends EnvironmentalBandSettings {
  visibilityStart: number;
  visibilityEnd: number;
  particles: SunbeamMoteParticleSettings;
}

export interface CalmPoolMaskSettings extends EnvironmentalBandSettings {
  minDepthM: number;
  maxFlowStrength: number;
}

export interface FrostMaskSettings extends EnvironmentalBandSettings {
  visibilityStart: number;
  visibilityEnd: number;
  wetnessSuppression: number;
}

export interface DewMaskSettings extends EnvironmentalBandSettings {
  wetnessStart: number;
  wetnessEnd: number;
}

export interface ShoreDebrisMaskSettings extends EnvironmentalBandSettings {
  shoreStartM: number;
  shoreEndM: number;
  maxFlowStrength: number;
}

export interface EnvironmentalMaskSettings {
  enabled: boolean;
  riverCobble: RiverCobbleMaskSettings;
  riverMist: RiverMistMaskSettings;
  rapidSplash: RapidSplashMaskSettings;
  sunbeamMote: SunbeamMoteMaskSettings;
  calmPool: CalmPoolMaskSettings;
  frost: FrostMaskSettings;
  dew: DewMaskSettings;
  shoreDebris: ShoreDebrisMaskSettings;
}

export interface EnvironmentalMaskValidity {
  water: boolean;
  river: boolean;
  normal: boolean;
  visibility: boolean;
}

export interface EnvironmentalMaskMeta {
  readonly cellSizeM: number;
  readonly revision: number;
  readonly validity: EnvironmentalMaskValidity;
  readonly water: EnvironmentQueryMeta;
  readonly river: EnvironmentQueryMeta;
  readonly normal: EnvironmentQueryMeta;
  readonly visibility: EnvironmentQueryMeta;
}

export interface EnvironmentalMaskSample {
  readonly riverCobble: number;
  readonly riverMist: number;
  readonly rapidSplash: number;
  readonly sunbeamMote: number;
  readonly calmPool: number;
  readonly frost: number;
  readonly dew: number;
  readonly shoreDebris: number;
  readonly meta: EnvironmentalMaskMeta;
}

export interface EnvironmentalMaskBatchBuffers {
  readonly riverCobble: Float32Array;
  readonly riverMist: Float32Array;
  readonly rapidSplash: Float32Array;
  readonly sunbeamMote: Float32Array;
  readonly calmPool: Float32Array;
  readonly frost: Float32Array;
  readonly dew: Float32Array;
  readonly shoreDebris: Float32Array;
  readonly validity: Uint8Array;
}
