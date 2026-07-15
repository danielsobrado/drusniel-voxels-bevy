import type {
  TreeEcologySettings,
  TreeFoliageSettings,
  TreeGpuSettings,
  TreeImpostorSettings,
  TreeSettings,
  TreeSpeciesId,
  TreeSpeciesSettings,
  TreeWindSettings,
} from "./tree_config_types.js";
import { TREE_MORPHOLOGY_RUNTIME_DEFAULTS } from "./morphology/constants.js";

function species(
  weight: number,
  minHeightM: number,
  maxHeightM: number,
  trunkHeightM: number,
  trunkRadiusM: number,
  crownRadiusM: number,
  trunkBend: number,
  trunkTaper: number,
  branchLevels: number,
  primaryBranchCount: number,
  secondaryBranchCount: number,
  branchSpread: number,
  branchUpSweep: number,
  branchLength: number,
  crownFlattening: number,
  crownIrregularity: number,
  leafClusterCount: number,
  leafCardCount: number,
  morphologyRuntime: TreeSpeciesSettings["morphologyRuntime"],
): TreeSpeciesSettings {
  return {
    enabled: true,
    weight,
    minHeightM,
    maxHeightM,
    trunkHeightM,
    trunkRadiusM,
    crownRadiusM,
    morphology: {
      trunkBend,
      trunkTaper,
      branchLevels,
      primaryBranchCount,
      secondaryBranchCount,
      branchSpread,
      branchUpSweep,
      branchLength,
      crownFlattening,
      crownIrregularity,
      leafClusterCount,
      leafCardCount,
    },
    morphologyRuntime: { ...morphologyRuntime },
  };
}

export const DEFAULT_TREE_SPECIES_SETTINGS: Record<TreeSpeciesId, TreeSpeciesSettings> = {
  oak: species(0.34, 10, 42, 8.0, 0.36, 4.2, 0.18, 0.62, 3, 8, 3, 0.85, 0.42, 2.4, 0.72, 0.28, 18, 44, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.oak),
  pine: species(0.22, 14, 58, 9.5, 0.30, 3.1, 0.08, 0.42, 3, 9, 1, 0.58, -0.08, 2.0, 1.45, 0.16, 12, 36, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.pine),
  dead: species(0.07, 14, 58, 8.0, 0.27, 0.0, 0.26, 0.58, 2, 5, 1, 0.9, 0.18, 1.9, 1.0, 0.45, 0, 0, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.dead),
  birch: species(0.16, 11, 46, 7.2, 0.26, 3.2, 0.12, 0.58, 3, 7, 2, 0.72, 0.32, 2.0, 0.8, 0.22, 14, 34, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.birch),
  willow: species(0.11, 9, 36, 5.5, 0.34, 4.6, 0.24, 0.64, 3, 8, 3, 1.1, -0.08, 2.8, 0.62, 0.34, 22, 50, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.willow),
  spruce: species(0.10, 16, 60, 10.0, 0.32, 3.4, 0.05, 0.38, 5, 10, 1, 0.62, -0.12, 2.2, 1.55, 0.14, 14, 38, TREE_MORPHOLOGY_RUNTIME_DEFAULTS.spruce),
};

export const DEFAULT_TREE_FOLIAGE_SETTINGS: TreeFoliageSettings = {
  enabled: false,
  alphaTest: 0,
  maskResolutionPx: 64,
  textureAtlasColumns: 4,
  textureAtlasRows: 2,
  debugShowAlphaCards: false,
  oak: {
    cardCountNear: 58,
    cardCountMid: 28,
    cardCountFar: 8,
    cardWidthM: 1.35,
    cardHeightM: 0.92,
    cardSizeVariation: 0.35,
    clusterSpreadM: 2.4,
    crownFlattening: 0.72,
    tintVariation: 0.18,
    edgeNoise: 0.34,
    lobeCount: 7,
    cutoutRoundness: 0.72,
  },
  pine: {
    cardCountNear: 54,
    cardCountMid: 24,
    cardCountFar: 8,
    cardWidthM: 1.05,
    cardHeightM: 1.35,
    cardSizeVariation: 0.28,
    clusterSpreadM: 1.8,
    crownFlattening: 1.45,
    tintVariation: 0.12,
    edgeNoise: 0.22,
    lobeCount: 5,
    cutoutRoundness: 0.48,
  },
};

export const DEFAULT_TREE_CANOPY_SETTINGS = DEFAULT_TREE_FOLIAGE_SETTINGS;
export const DEFAULT_TREE_CANOPY_LOW_POLY_SETTINGS = DEFAULT_TREE_FOLIAGE_SETTINGS;

export const DEFAULT_TREE_IMPOSTOR_SETTINGS: TreeImpostorSettings = {
  enabled: true,
  bakeOnStart: true,
  fallbackToPlaceholder: false,
  swapOnBake: true,
  sourceLod: "mid",
  resolutionPx: 64,
  octahedralGridSize: 8,
  atlasPaddingPx: 2,
  alphaTest: 0.38,
  frameUpdateDistanceM: 3.0,
  axialBillboard: true,
  preserveVertical: true,
  maxBakesPerFrame: 1,
  debugShowFrames: false,
  debugFreezeFrame: -1,
  futureNormalDepth: true,
};

export const DEFAULT_TREE_WIND_SETTINGS: TreeWindSettings = {
  enabled: true,
  direction: [0.8, 0.6],
  strength: 0.14,
  speed: 0.8,
  gustStrength: 0.10,
  trunkSwayStrength: 0.36,
  leafFlutterStrength: 0.14,
};

export const DEFAULT_TREE_GPU_SETTINGS: TreeGpuSettings = {
  enabled: true,
  preferWebGpu: true,
  fallbackToCpu: true,
  scatterEnabled: true,
  cullEnabled: true,
  maxVisible: 128_000,
  workgroupSize: 64,
  readbackVisibleLists: false,
  debugForceCpu: false,
  debugShowGpuCounts: false,
  debugValidateAgainstCpu: false,
  terrainVisibility: {
    enabled: true,
    minDistanceM: 120,
    sampleCount: 3,
    heightMarginM: 2.0,
    crownHeightM: 5.5,
  },
};

export const DEFAULT_TREE_ECOLOGY_SETTINGS: TreeEcologySettings = {
  enabled: true,
  density: {
    baseDensity: 0.82,
    forestNoiseScaleM: 96,
    forestNoiseStrength: 0.9,
    clearingNoiseScaleM: 180,
    clearingThreshold: 0.68,
    clearingSoftness: 0.18,
    edgeSoftnessM: 12,
  },
  terrain: {
    lowlandHeightM: 16,
    highlandHeightM: 42,
    heightFadeM: 8,
    slopeFadeStartY: 0.62,
    slopeFadeEndY: 0.9,
    materialWeightPower: 1.35,
  },
  clustering: {
    clusterScaleM: 26,
    clusterStrength: 0.82,
    clusterThreshold: 0.36,
    minSpacingJitter: 0.35,
  },
  age: {
    youngProbability: 0.24,
    oldProbability: 0.18,
    scaleYoung: 0.65,
    scaleMature: 1.0,
    scaleOld: 1.28,
    scaleVariation: 0.22,
  },
  speciesZones: {
    oak: { heightPreference: "low", moisturePreference: 0.65, slopeTolerance: 0.55, clusterBias: 0.75, oldForestBias: 0 },
    pine: { heightPreference: "high", moisturePreference: 0.35, slopeTolerance: 0.85, clusterBias: 0.9, oldForestBias: 0 },
    dead: { heightPreference: "any", moisturePreference: 0.45, slopeTolerance: 0.75, clusterBias: 1.0, oldForestBias: 0.85 },
    birch: { heightPreference: "low", moisturePreference: 0.58, slopeTolerance: 0.72, clusterBias: 0.45, oldForestBias: 0.12 },
    willow: { heightPreference: "low", moisturePreference: 0.86, slopeTolerance: 0.45, clusterBias: 0.65, oldForestBias: 0.08 },
    spruce: { heightPreference: "high", moisturePreference: 0.42, slopeTolerance: 0.9, clusterBias: 1.05, oldForestBias: 0.18 },
  },
};

export const DEFAULT_TREE_SETTINGS: TreeSettings = {
  enabled: true,
  seed: 7331,
  distanceM: 420,
  refreshDistanceM: 20,
  maxNewPatchesPerFrame: 1,
  maxInstances: 6000,
  species: DEFAULT_TREE_SPECIES_SETTINGS,
  placement: {
    spacingM: 6.8,
    jitter: 0.70,
    slopeMinY: 0.64,
    minHeightM: 10,
    maxHeightM: 58,
    minGroundWeight: 0.14,
    minSpacingM: 4.0,
  },
  lod: {
    nearFraction: 0.062,
    midFraction: 0.24,
    farFraction: 0.62,
    impostorFraction: 1.0,
    hysteresisM: 8,
    crossfadeEnabled: true,
    crossfadeBandM: 20,
    ditherEnabled: true,
    shadowsMaxLod: "none",
    budgets: {
      nearMaxVertices: 180_000,
      midMaxVertices: 60_000,
      farMaxVertices: 24_000,
      impostorMaxVertices: 240,
    },
  },
  impostors: DEFAULT_TREE_IMPOSTOR_SETTINGS,
  foliage: DEFAULT_TREE_FOLIAGE_SETTINGS,
  wind: { ...DEFAULT_TREE_WIND_SETTINGS, direction: [...DEFAULT_TREE_WIND_SETTINGS.direction] },
  render: {
    alphaTest: 0.42,
    castShadows: true,
    receiveShadows: true,
    depthPrepass: true,
    debugColorByLod: false,
    farCheapMaterial: true,
    placementDebug: false,
  },
  gpu: DEFAULT_TREE_GPU_SETTINGS,
  ecology: DEFAULT_TREE_ECOLOGY_SETTINGS,
};

export function cloneTreeSettings(source: TreeSettings = DEFAULT_TREE_SETTINGS): TreeSettings {
  return structuredClone(source);
}
