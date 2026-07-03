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
  grass: terrainDefaults(1.20, 1.00, 1.18, 0.92, 1.30, 0.60, 0.65),
  rock: terrainDefaults(0.48, 0.62, 0.24, 0.55, 0.08, 1.35, 1.28),
  sand: terrainDefaults(0.62, 0.44, 0.22, 0.24, 0.75, 0.48, 0.44),
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
  distanceM: 100,
  refreshDistanceM: 16,
  maxNewPatchesPerFrame: 1,
  maxInstances: 7000,
  placement: {
    spacingM: 3.0,
    jitter: 0.55,
    slopeMinY: 0.68,
    minHeightM: 8,
    maxHeightM: 52,
    minGroundWeight: 0.12,
    minTreeInfluence: 0.0,
  },
  ecology: {
    enabled: true,
    forestInfluenceScaleM: 36,
    forestEdgeWidthM: 18,
    clearingPreference: 0.55,
    moistureNoiseScaleM: 80,
    moistureStrength: 0.65,
    shadeStrength: 0.75,
    densityNoiseScaleM: 28,
    densityNoiseStrength: 0.55,
    deadfallOldForestBias: 0.75,
  },
  terrain: cloneUnderstoryTerrainWeights(DEFAULT_UNDERSTORY_TERRAIN_WEIGHTS),
  classes: {
    shrub: classDefaults(0.30, 1.0, 0.7, 1.6, "any", 0.55, 0.45, 0.65, 0.35),
    fern: classDefaults(0.24, 1.0, 0.55, 1.25, "low", 0.85, 0.80, 0.25, 0.55),
    sapling: classDefaults(0.16, 0.55, 0.45, 1.15, "any", 0.45, 0.50, 0.55, 0.45),
    flower: classDefaults(0.18, 0.85, 0.35, 0.95, "low", 0.15, 0.45, 0.85, 0.65),
    dead_log: classDefaults(0.08, 0.22, 0.8, 1.9, "any", 0.75, 0.55, 0.30, 0.0),
    stump: classDefaults(0.04, 0.16, 0.7, 1.4, "any", 0.65, 0.45, 0.25, 0.0),
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
