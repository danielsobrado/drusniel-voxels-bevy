export interface HydrologyFillConfig {
  enabled: boolean;
  iterations: number;
  epsilonPerCell: number;
  lakeDelta: number;
  marshDelta: number;
}

export interface HydrologyAccumulationConfig {
  particles: number;
  maxSteps: number;
  flatGradientStop: number;
  inertia: number;
  jitterSeed: number;
}

export interface HydrologyRiversConfig {
  riverThresholdAdd: number;
  visibleWaterThresholdAdd: number;
  widenRadius: number;
  carveDepthM: number;
  carvePower: number;
  visibleDepthM: number;
  visibleDepthPower: number;
  slopeGateStart: number;
  slopeGateEnd: number;
  minVisibleDepth: number;
}

export interface HydrologyWaterSurfaceConfig {
  wetSmoothIterations: number;
  wetToWetCliffSlopeMax: number;
  farReduceFactor: number;
}

export interface HydrologyTalusConfig {
  enabled: boolean;
  iterations: number;
  strength: number;
}

export interface HydrologyDebugConfig {
  showFill: boolean;
  showAccumulation: boolean;
  showCarvedBed: boolean;
  showWaterY: boolean;
}

export interface HydrologyConfig {
  enabled: boolean;
  simRes: number;
  drySentinelDepth: number;
  fill: HydrologyFillConfig;
  accumulation: HydrologyAccumulationConfig;
  rivers: HydrologyRiversConfig;
  waterSurface: HydrologyWaterSurfaceConfig;
  talus: HydrologyTalusConfig;
  debug: HydrologyDebugConfig;
}

export const DEFAULT_HYDROLOGY_CONFIG: HydrologyConfig = {
  enabled: true,
  simRes: 256,
  drySentinelDepth: 2.0,
  fill: {
    enabled: true,
    iterations: 900,
    epsilonPerCell: 0.0045,
    lakeDelta: 2.2,
    marshDelta: 0.15,
  },
  accumulation: {
    particles: 350_000,
    maxSteps: 220,
    flatGradientStop: 0.012,
    inertia: 0.45,
    jitterSeed: 12345,
  },
  rivers: {
    riverThresholdAdd: 14,
    visibleWaterThresholdAdd: 320,
    widenRadius: 2,
    carveDepthM: 7.5,
    carvePower: 1.35,
    visibleDepthM: 3.3,
    visibleDepthPower: 2.2,
    slopeGateStart: 0.50,
    slopeGateEnd: 0.24,
    minVisibleDepth: 0.05,
  },
  waterSurface: {
    wetSmoothIterations: 2,
    wetToWetCliffSlopeMax: 0.35,
    farReduceFactor: 8,
  },
  talus: {
    enabled: true,
    iterations: 8,
    strength: 0.12,
  },
  debug: {
    showFill: false,
    showAccumulation: false,
    showCarvedBed: false,
    showWaterY: false,
  },
};

export function cloneHydrologyConfig(config: HydrologyConfig = DEFAULT_HYDROLOGY_CONFIG): HydrologyConfig {
  return {
    ...config,
    fill: { ...config.fill },
    accumulation: { ...config.accumulation },
    rivers: { ...config.rivers },
    waterSurface: { ...config.waterSurface },
    talus: { ...config.talus },
    debug: { ...config.debug },
  };
}
