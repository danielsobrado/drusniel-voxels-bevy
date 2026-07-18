export type MaterialClass = "grass" | "dirt" | "rock" | "sand" | "snow" | "water";

export const TREE_LODS = ["near", "mid", "far", "impostor"] as const;
export type TreeLod = typeof TREE_LODS[number];

export const TREE_SPECIES = ["oak", "pine", "dead", "birch", "willow", "spruce"] as const;
export type TreeSpeciesId = typeof TREE_SPECIES[number];

export interface TreeSettings {
  enabled: boolean;
  seed: number;
  distanceM: number;
  refreshDistanceM: number;
  maxNewPatchesPerFrame: number;
  maxInstances: number;
  species: Record<TreeSpeciesId, TreeSpeciesSettings>;
  placement: TreePlacementSettings;
  lod: TreeLodSettings;
  impostors: TreeImpostorSettings;
  foliage: TreeFoliageSettings;
  wind: TreeWindSettings;
  render: TreeRenderSettings;
  gpu: TreeGpuSettings;
  ecology: TreeEcologySettings;
}

export interface TreeSpeciesSettings {
  enabled: boolean;
  weight: number;
  minHeightM: number;
  maxHeightM: number;
  trunkHeightM: number;
  trunkRadiusM: number;
  crownRadiusM: number;
  morphology: TreeSpeciesMorphologySettings;
  morphologyRuntime: TreeSpeciesMorphologyRuntimeSettings;
  minScale?: number;
  maxScale?: number;
  minSlopeY?: number;
  maxSlopeY?: number;
  maxWaterDistanceM?: number;
  minWaterDistanceM?: number;
  minMoisture?: number;
  maxMoisture?: number;
  altitudePreference?: "lowland" | "mid" | "highland" | "any";
  materialWeights?: Partial<Record<MaterialClass, number>>;
  tint?: string;
}

export interface TreeSpeciesMorphologyRuntimeSettings {
  slopeLean: number;
  windLean: number;
  randomLean: number;
  exposureFlattening: number;
  ageFlattening: number;
  baseDroop: number;
  ageDroop: number;
  moistureDroop: number;
  baseStiffness: number;
}

export interface TreeSpeciesMorphologySettings {
  trunkBend: number;
  trunkTaper: number;
  branchLevels: number;
  primaryBranchCount: number;
  secondaryBranchCount: number;
  branchSpread: number;
  branchUpSweep: number;
  branchLength: number;
  crownFlattening: number;
  crownIrregularity: number;
  leafClusterCount: number;
  leafCardCount: number;
}

export interface TreePlacementSettings {
  spacingM: number;
  jitter: number;
  slopeMinY: number;
  minHeightM: number;
  maxHeightM: number;
  minGroundWeight: number;
  minSpacingM: number;
}

export interface TreeLodSettings {
  nearFraction: number;
  midFraction: number;
  farFraction: number;
  impostorFraction: number;
  hysteresisM: number;
  crossfadeEnabled: boolean;
  crossfadeBandM: number;
  ditherEnabled: boolean;
  shadowsMaxLod: TreeLod | "none";
  budgets: {
    nearMaxVertices: number;
    midMaxVertices: number;
    farMaxVertices: number;
    impostorMaxVertices: number;
  };
}

export interface TreeImpostorSettings {
  enabled: boolean;
  bakeOnStart: boolean;
  fallbackToPlaceholder: boolean;
  swapOnBake: boolean;
  sourceLod: Exclude<TreeLod, "impostor">;
  /** Full young/mature/old atlas pages. Disable to spend memory on sharper mature pages. */
  bakeAgeLayers: boolean;
  resolutionPx: number;
  octahedralGridSize: number;
  atlasPaddingPx: number;
  alphaTest: number;
  frameUpdateDistanceM: number;
  axialBillboard: boolean;
  preserveVertical: boolean;
  maxBakesPerFrame: number;
  debugShowFrames: boolean;
  debugFreezeFrame: number;
  futureNormalDepth: boolean;
}

export interface TreeSpeciesFoliageSettings {
  cardCountNear: number;
  cardCountMid: number;
  cardCountFar: number;
  cardWidthM: number;
  cardHeightM: number;
  cardSizeVariation: number;
  clusterSpreadM: number;
  crownFlattening: number;
  tintVariation: number;
  edgeNoise: number;
  lobeCount: number;
  cutoutRoundness: number;
}

export interface TreeFoliageSettings {
  enabled: boolean;
  alphaTest: number;
  maskResolutionPx: number;
  textureAtlasColumns: number;
  textureAtlasRows: number;
  debugShowAlphaCards: boolean;
  oak: TreeSpeciesFoliageSettings;
  pine: TreeSpeciesFoliageSettings;
}

export type TreeCanopySpeciesSettings = TreeSpeciesFoliageSettings;
export type TreeCanopySettings = TreeFoliageSettings;

export interface TreeWindSettings {
  enabled: boolean;
  direction: [number, number];
  strength: number;
  speed: number;
  gustStrength: number;
  trunkSwayStrength: number;
  leafFlutterStrength: number;
}

export interface TreeRenderSettings {
  alphaTest: number;
  castShadows: boolean;
  receiveShadows: boolean;
  depthPrepass: boolean;
  debugColorByLod: boolean;
  farCheapMaterial: boolean;
  placementDebug: boolean;
}

export interface TreeGpuSettings {
  enabled: boolean;
  preferWebGpu: boolean;
  fallbackToCpu: boolean;
  scatterEnabled: boolean;
  cullEnabled: boolean;
  maxVisible: number;
  workgroupSize: number;
  readbackVisibleLists: boolean;
  debugForceCpu: boolean;
  debugShowGpuCounts: boolean;
  debugValidateAgainstCpu: boolean;
  terrainVisibility: TreeTerrainVisibilitySettings;
}

export interface TreeTerrainVisibilitySettings {
  enabled: boolean;
  minDistanceM: number;
  sampleCount: number;
  heightMarginM: number;
  crownHeightM: number;
}

export interface TreeSpeciesZoneSettings {
  heightPreference: "low" | "high" | "any";
  moisturePreference: number;
  slopeTolerance: number;
  clusterBias: number;
  oldForestBias: number;
}

export interface TreeEcologySettings {
  enabled: boolean;
  density: {
    baseDensity: number;
    forestNoiseScaleM: number;
    forestNoiseStrength: number;
    clearingNoiseScaleM: number;
    clearingThreshold: number;
    clearingSoftness: number;
    edgeSoftnessM: number;
  };
  terrain: {
    lowlandHeightM: number;
    highlandHeightM: number;
    heightFadeM: number;
    slopeFadeStartY: number;
    slopeFadeEndY: number;
    materialWeightPower: number;
  };
  clustering: {
    clusterScaleM: number;
    clusterStrength: number;
    clusterThreshold: number;
    minSpacingJitter: number;
  };
  age: {
    youngProbability: number;
    oldProbability: number;
    scaleYoung: number;
    scaleMature: number;
    scaleOld: number;
    scaleVariation: number;
  };
  speciesZones: Record<TreeSpeciesId, TreeSpeciesZoneSettings>;
}
