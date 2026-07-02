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
  };
}

export const DEFAULT_TREE_SPECIES_SETTINGS: Record<TreeSpeciesId, TreeSpeciesSettings> = {
  oak: species(0.34, 10, 42, 8.0, 0.36, 4.2, 0.18, 0.62, 3, 8, 3, 0.85, 0.42, 2.4, 0.72, 0.28, 18, 44),
  pine: species(0.22, 14, 58, 9.5, 0.30, 3.1, 0.08, 0.42, 3, 9, 1, 0.58, -0.08, 2.0, 1.45, 0.16, 12, 36),
  dead: species(0.07, 14, 58, 8.0, 0.27, 0.0, 0.26, 0.58, 2, 5, 1, 0.9, 0.18, 1.9, 1.0, 0.45, 0, 0),
  birch: species(0.16, 11, 46, 7.2, 0.26, 3.2, 0.12, 0.55, 3, 7, 2, 0.72, 0.36, 2.0, 0.88, 0.20, 14, 34),
  willow: species(0.12, 8, 34, 6.4, 0.34, 4.6, 0.32, 0.68, 3, 8, 3, 1.05, 0.18, 2.5, 0.62, 0.34, 20, 48),
  spruce: species(0.09, 20, 64, 10.5, 0.32, 3.0, 0.06, 0.38, 4, 10, 1, 0.50, -0.16, 2.1, 1.65, 0.12, 16, 40),
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
  sourceLod: "near",
  resolutionPx: 256,
  octahedralGridSize: 8,
  atlasPaddingPx: 2,
  alphaTest: 0.35,
  frameUpdateDistanceM: 2.0,
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
  strength: 0.18,
  speed: 0.9,
  gustStrength: 0.12,
  trunkSwayStrength: 0.45,
  leafFlutterStrength: 0.18,
};

export const DEFAULT_TREE_GPU_SETTINGS: TreeGpuSettings = {
  enabled: true,
  preferWebGpu: true,
  fallbackToCpu: true,
  scatterEnabled: true,
  cullEnabled: true,
  maxVisible: 50_000,
  workgroupSize: 64,
  readbackVisibleLists: false,
  debugForceCpu: false,
  debugShowGpuCounts: false,
  debugValidateAgainstCpu: false,
  terrainVisibility: {
    enabled: true,
    minDistanceM: 96,
    sampleCount: 6,
    heightMarginM: 1.75,
    crownHeightM: 5.5,
  },
};

export const DEFAULT_TREE_ECOLOGY_SETTINGS: TreeEcologySettings = {
  enabled: true,
  density: {
    baseDensity: 1.2,
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
  distanceM: 620,
  refreshDistanceM: 16,
  maxNewPatchesPerFrame: 2,
  maxInstances: 9000,
  species: DEFAULT_TREE_SPECIES_SETTINGS,
  placement: {
    spacingM: 5.5,
    jitter: 0.72,
    slopeMinY: 0.64,
    minHeightM: 10,
    maxHeightM: 58,
    minGroundWeight: 0.14,
    minSpacingM: 3.4,
  },
  lod: {
    nearFraction: 0.042,
    midFraction: 0.18,
    farFraction: 0.35,
    impostorFraction: 1.0,
    hysteresisM: 8,
    crossfadeEnabled: true,
    crossfadeBandM: 24,
    ditherEnabled: true,
    shadowsMaxLod: "near",
    budgets: {
      nearMaxVertices: 260_000,
      midMaxVertices: 90_000,
      farMaxVertices: 40_000,
      impostorMaxVertices: 240,
    },
  },
  impostors: DEFAULT_TREE_IMPOSTOR_SETTINGS,
  foliage: DEFAULT_TREE_FOLIAGE_SETTINGS,
  wind: DEFAULT_TREE_WIND_SETTINGS,
  render: {
    alphaTest: 0.42,
    castShadows: true,
    receiveShadows: true,
    depthPrepass: true,
    debugColorByLod: false,
  },
  gpu: DEFAULT_TREE_GPU_SETTINGS,
  ecology: DEFAULT_TREE_ECOLOGY_SETTINGS,
};

export function cloneTreeSettings(): TreeSettings {
  return structuredClone(DEFAULT_TREE_SETTINGS);
}
