import type {
  UnderstoryHeightPreference,
  UnderstoryClassSettings,
  UnderstoryGpuSettings,
  UnderstorySettings,
  UnderstoryTerrainClassWeights,
  UnderstoryTerrainWeights,
} from "./understory_config_types.js";

function terrainDefaults(
  density: number,
  shrub: number,
  fern: number,
  sapling: number,
  flower: number,
  deadLog: number,
  stump: number,
): UnderstoryTerrainClassWeights {
  return { density, shrub, fern, sapling, flower, dead_log: deadLog, stump };
}

export const DEFAULT_UNDERSTORY_TERRAIN_WEIGHTS: UnderstoryTerrainWeights = {
  grass: terrainDefaults(1.25, 1.08, 1.35, 0.96, 0.75, 0.72, 0.72),
  rock: terrainDefaults(0.48, 0.62, 0.28, 0.55, 0.06, 1.35, 1.28),
  sand: terrainDefaults(0.62, 0.44, 0.24, 0.24, 0.55, 0.48, 0.44),
  snow: terrainDefaults(0.18, 0.30, 0.10, 0.12, 0.02, 1.60, 1.35),
};

export const DEFAULT_UNDERSTORY_GPU_SETTINGS: UnderstoryGpuSettings = {
  enabled: true,
  fallbackToCpu: true,
  debugForceCpu: false,
  maxVisible: 12_000,
  workgroupSize: 64,
  readbackVisibleLists: false,
  debugShowGpuCounts: false,
  debugValidateAgainstCpu: false,
};

function classDefaults(
  weight: number,
  density: number,
  minScale: number,
  maxScale: number,
  heightPreference: UnderstoryHeightPreference,
  shadePreference: number,
  moisturePreference: number,
  forestEdgeBias: number,
  windWeight: number,
): UnderstoryClassSettings {
  return {
    enabled: true,
    weight,
    density,
    minScale,
    maxScale,
    heightPreference,
    shadePreference,
    moisturePreference,
    forestEdgeBias,
    windWeight,
  };
}

function cloneUnderstoryTerrainWeights(weights: UnderstoryTerrainWeights): UnderstoryTerrainWeights {
  return {
    grass: { ...weights.grass },
    rock: { ...weights.rock },
    sand: { ...weights.sand },
    snow: { ...weights.snow },
  };
}

export const DEFAULT_UNDERSTORY_SETTINGS: UnderstorySettings = {
  enabled: true,
  seed: 9137,
  distanceM: 110,
  refreshDistanceM: 16,
  maxNewPatchesPerFrame: 1,
  maxInstances: 10000,
  placement: {
    spacingM: 2.6,
    jitter: 0.62,
    slopeMinY: 0.68,
    minHeightM: 8,
    maxHeightM: 52,
    minGroundWeight: 0.12,
    minTreeInfluence: 0.0,
  },
  ecology: {
    enabled: true,
    forestInfluenceScaleM: 32,
    forestEdgeWidthM: 18,
    clearingPreference: 0.55,
    moistureNoiseScaleM: 80,
    moistureStrength: 0.65,
    shadeStrength: 0.82,
    densityNoiseScaleM: 28,
    densityNoiseStrength: 0.62,
    deadfallOldForestBias: 0.75,
  },
  terrain: cloneUnderstoryTerrainWeights(DEFAULT_UNDERSTORY_TERRAIN_WEIGHTS),
  classes: {
    shrub: classDefaults(0.28, 1.10, 0.65, 1.55, "any", 0.62, 0.45, 0.58, 0.35),
    fern: classDefaults(0.34, 1.30, 0.55, 1.35, "low", 0.92, 0.82, 0.20, 0.55),
    sapling: classDefaults(0.16, 0.62, 0.45, 1.15, "any", 0.50, 0.50, 0.50, 0.45),
    flower: classDefaults(0.10, 0.50, 0.35, 0.90, "low", 0.10, 0.45, 0.90, 0.65),
    dead_log: classDefaults(0.08, 0.25, 0.8, 1.9, "any", 0.80, 0.55, 0.25, 0.0),
    stump: classDefaults(0.04, 0.18, 0.7, 1.4, "any", 0.72, 0.45, 0.20, 0.0),
  },
  render: {
    debugColorByClass: false,
    alphaTest: 0.45,
    shadows: false,
    maxShadowClass: "shrub",
  },
  gpu: { ...DEFAULT_UNDERSTORY_GPU_SETTINGS },
};

export function cloneUnderstorySettings(settings: UnderstorySettings = DEFAULT_UNDERSTORY_SETTINGS): UnderstorySettings {
  return {
    ...settings,
    placement: { ...settings.placement },
    ecology: { ...settings.ecology },
    terrain: cloneUnderstoryTerrainWeights(settings.terrain),
    classes: {
      shrub: { ...settings.classes.shrub },
      fern: { ...settings.classes.fern },
      sapling: { ...settings.classes.sapling },
      flower: { ...settings.classes.flower },
      dead_log: { ...settings.classes.dead_log },
      stump: { ...settings.classes.stump },
    },
    render: { ...settings.render },
    gpu: { ...settings.gpu },
  };
}
