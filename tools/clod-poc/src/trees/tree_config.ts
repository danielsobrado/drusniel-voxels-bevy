import { load } from "js-yaml";
import treesYaml from "../../config/trees.yaml?raw";

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
  sourceLod: Exclude<TreeLod, "impostor">;
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

type WarnHandler = ((message: string) => void) | null;

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
  sourceLod: "mid",
  resolutionPx: 128,
  octahedralGridSize: 8,
  atlasPaddingPx: 2,
  alphaTest: 0.45,
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
  enabled: false,
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
  species: cloneRecord(DEFAULT_TREE_SPECIES_SETTINGS),
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
      nearMaxVertices: 260000,
      midMaxVertices: 90000,
      farMaxVertices: 40000,
      impostorMaxVertices: 240,
    },
  },
  impostors: cloneTreeImpostorSettings(DEFAULT_TREE_IMPOSTOR_SETTINGS),
  foliage: cloneFoliageSettings(DEFAULT_TREE_FOLIAGE_SETTINGS),
  wind: cloneWindSettings(DEFAULT_TREE_WIND_SETTINGS),
  render: {
    alphaTest: 0.38,
    castShadows: true,
    receiveShadows: true,
    depthPrepass: true,
    debugColorByLod: false,
  },
  gpu: { ...DEFAULT_TREE_GPU_SETTINGS },
  ecology: cloneEcologySettings(DEFAULT_TREE_ECOLOGY_SETTINGS),
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boolFrom(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberFrom(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function intFrom(value: unknown, fallback: number): number {
  return Math.floor(numberFrom(value, fallback));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampedNumberFrom(value: unknown, fallback: number, min: number, max: number): number {
  return clamp(numberFrom(value, fallback), min, max);
}

function clampedIntFrom(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(clampedNumberFrom(value, fallback, min, max));
}

function shadowLodFrom(value: unknown, fallback: TreeLod | "none"): TreeLod | "none" {
  return value === "none" || TREE_LODS.includes(value as TreeLod) ? value as TreeLod | "none" : fallback;
}

function impostorSourceLodFrom(value: unknown, fallback: Exclude<TreeLod, "impostor">): Exclude<TreeLod, "impostor"> {
  return value === "near" || value === "mid" || value === "far" ? value : fallback;
}

function heightPreferenceFrom(value: unknown, fallback: TreeSpeciesZoneSettings["heightPreference"]): TreeSpeciesZoneSettings["heightPreference"] {
  return value === "low" || value === "high" || value === "any" ? value : fallback;
}

function parseMorphology(raw: unknown, fallback: TreeSpeciesMorphologySettings): TreeSpeciesMorphologySettings {
  const src = record(raw);
  return {
    trunkBend: numberFrom(src.trunk_bend, fallback.trunkBend),
    trunkTaper: numberFrom(src.trunk_taper, fallback.trunkTaper),
    branchLevels: intFrom(src.branch_levels, fallback.branchLevels),
    primaryBranchCount: intFrom(src.primary_branch_count, fallback.primaryBranchCount),
    secondaryBranchCount: intFrom(src.secondary_branch_count, fallback.secondaryBranchCount),
    branchSpread: numberFrom(src.branch_spread, fallback.branchSpread),
    branchUpSweep: numberFrom(src.branch_up_sweep, fallback.branchUpSweep),
    branchLength: numberFrom(src.branch_length, fallback.branchLength),
    crownFlattening: numberFrom(src.crown_flattening, fallback.crownFlattening),
    crownIrregularity: numberFrom(src.crown_irregularity, fallback.crownIrregularity),
    leafClusterCount: intFrom(src.leaf_cluster_count, fallback.leafClusterCount),
    leafCardCount: intFrom(src.leaf_card_count, fallback.leafCardCount),
  };
}

function parseSpeciesSettings(raw: unknown, fallback: TreeSpeciesSettings): TreeSpeciesSettings {
  const src = record(raw);
  return {
    ...fallback,
    enabled: boolFrom(src.enabled, fallback.enabled),
    weight: numberFrom(src.weight, fallback.weight),
    minHeightM: numberFrom(src.min_height_m, fallback.minHeightM),
    maxHeightM: numberFrom(src.max_height_m, fallback.maxHeightM),
    trunkHeightM: numberFrom(src.trunk_height_m, fallback.trunkHeightM),
    trunkRadiusM: numberFrom(src.trunk_radius_m, fallback.trunkRadiusM),
    crownRadiusM: numberFrom(src.crown_radius_m, fallback.crownRadiusM),
    morphology: parseMorphology(src.morphology, fallback.morphology),
  };
}

function parseFoliageSpecies(raw: unknown, fallback: TreeSpeciesFoliageSettings): TreeSpeciesFoliageSettings {
  const src = record(raw);
  return {
    cardCountNear: Math.max(0, intFrom(src.card_count_near, fallback.cardCountNear)),
    cardCountMid: Math.max(0, intFrom(src.card_count_mid, fallback.cardCountMid)),
    cardCountFar: Math.max(0, intFrom(src.card_count_far, fallback.cardCountFar)),
    cardWidthM: numberFrom(src.card_width_m, fallback.cardWidthM),
    cardHeightM: numberFrom(src.card_height_m, fallback.cardHeightM),
    cardSizeVariation: numberFrom(src.card_size_variation, fallback.cardSizeVariation),
    clusterSpreadM: numberFrom(src.cluster_spread_m, fallback.clusterSpreadM),
    crownFlattening: numberFrom(src.crown_flattening, fallback.crownFlattening),
    tintVariation: numberFrom(src.tint_variation, fallback.tintVariation),
    edgeNoise: numberFrom(src.edge_noise, fallback.edgeNoise),
    lobeCount: Math.max(1, intFrom(src.lobe_count, fallback.lobeCount)),
    cutoutRoundness: numberFrom(src.cutout_roundness, fallback.cutoutRoundness),
  };
}

function parseSpeciesZone(raw: unknown, fallback: TreeSpeciesZoneSettings): TreeSpeciesZoneSettings {
  const src = record(raw);
  return {
    heightPreference: heightPreferenceFrom(src.height_preference, fallback.heightPreference),
    moisturePreference: numberFrom(src.moisture_preference, fallback.moisturePreference),
    slopeTolerance: numberFrom(src.slope_tolerance, fallback.slopeTolerance),
    clusterBias: numberFrom(src.cluster_bias, fallback.clusterBias),
    oldForestBias: numberFrom(src.old_forest_bias, fallback.oldForestBias),
  };
}

function budgetFrom(raw: Record<string, unknown>, flatKey: string, nestedKey: TreeLod, fallback: number): number {
  const nested = record(record(raw.budgets)[nestedKey]);
  return intFrom(record(raw.budgets)[flatKey] ?? nested.max_vertices, fallback);
}

export function parseTreeConfig(yamlText = treesYaml, warn: WarnHandler = console.warn): TreeSettings {
  try {
    const root = record(load(yamlText));
    const trees = record(root.trees);
    const placementRoot = record(trees.placement);
    const lodRoot = record(trees.lod);
    const impostorRoot = record(trees.impostors);
    const foliageRoot = record(trees.foliage);
    const windRoot = record(trees.wind);
    const renderRoot = record(trees.render);
    const gpuRoot = record(trees.gpu);
    const speciesRoot = record(trees.species);
    const ecologyRoot = record(trees.ecology);
    const densityRoot = record(ecologyRoot.density);
    const terrainRoot = record(ecologyRoot.terrain);
    const clusteringRoot = record(ecologyRoot.clustering);
    const ageRoot = record(ecologyRoot.age);
    const zonesRoot = record(ecologyRoot.species_zones);

    const fallback = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    const species = {} as Record<TreeSpeciesId, TreeSpeciesSettings>;
    for (const id of TREE_SPECIES) species[id] = parseSpeciesSettings(speciesRoot[id], fallback.species[id]);

    const speciesZones = {} as Record<TreeSpeciesId, TreeSpeciesZoneSettings>;
    for (const id of TREE_SPECIES) speciesZones[id] = parseSpeciesZone(zonesRoot[id], fallback.ecology.speciesZones[id]);

    return {
      enabled: boolFrom(trees.enabled, fallback.enabled),
      seed: intFrom(trees.seed, fallback.seed),
      distanceM: numberFrom(trees.distance_m, fallback.distanceM),
      refreshDistanceM: numberFrom(trees.refresh_distance_m, fallback.refreshDistanceM),
      maxNewPatchesPerFrame: Math.max(1, intFrom(trees.max_new_patches_per_frame, fallback.maxNewPatchesPerFrame)),
      maxInstances: Math.max(0, intFrom(trees.max_instances, fallback.maxInstances)),
      species,
      placement: {
        spacingM: numberFrom(placementRoot.spacing_m, fallback.placement.spacingM),
        jitter: numberFrom(placementRoot.jitter, fallback.placement.jitter),
        slopeMinY: numberFrom(placementRoot.slope_min_y, fallback.placement.slopeMinY),
        minHeightM: numberFrom(placementRoot.min_height_m, fallback.placement.minHeightM),
        maxHeightM: numberFrom(placementRoot.max_height_m, fallback.placement.maxHeightM),
        minGroundWeight: numberFrom(placementRoot.min_ground_weight, fallback.placement.minGroundWeight),
        minSpacingM: numberFrom(placementRoot.min_spacing_m, fallback.placement.minSpacingM),
      },
      lod: {
        nearFraction: numberFrom(lodRoot.near_fraction, fallback.lod.nearFraction),
        midFraction: numberFrom(lodRoot.mid_fraction, fallback.lod.midFraction),
        farFraction: numberFrom(lodRoot.far_fraction, fallback.lod.farFraction),
        impostorFraction: numberFrom(lodRoot.impostor_fraction, fallback.lod.impostorFraction),
        hysteresisM: numberFrom(lodRoot.hysteresis_m, fallback.lod.hysteresisM),
        crossfadeEnabled: boolFrom(lodRoot.crossfade_enabled, fallback.lod.crossfadeEnabled),
        crossfadeBandM: numberFrom(lodRoot.crossfade_band_m, fallback.lod.crossfadeBandM),
        ditherEnabled: boolFrom(lodRoot.dither_enabled, fallback.lod.ditherEnabled),
        shadowsMaxLod: shadowLodFrom(lodRoot.shadows_max_lod, fallback.lod.shadowsMaxLod),
        budgets: {
          nearMaxVertices: budgetFrom(lodRoot, "near_max_vertices", "near", fallback.lod.budgets.nearMaxVertices),
          midMaxVertices: budgetFrom(lodRoot, "mid_max_vertices", "mid", fallback.lod.budgets.midMaxVertices),
          farMaxVertices: budgetFrom(lodRoot, "far_max_vertices", "far", fallback.lod.budgets.farMaxVertices),
          impostorMaxVertices: budgetFrom(lodRoot, "impostor_max_vertices", "impostor", fallback.lod.budgets.impostorMaxVertices),
        },
      },
      impostors: {
        enabled: boolFrom(impostorRoot.enabled, fallback.impostors.enabled),
        bakeOnStart: boolFrom(impostorRoot.bake_on_start, fallback.impostors.bakeOnStart),
        fallbackToPlaceholder: boolFrom(impostorRoot.fallback_to_placeholder, fallback.impostors.fallbackToPlaceholder),
        sourceLod: impostorSourceLodFrom(impostorRoot.source_lod, fallback.impostors.sourceLod),
        resolutionPx: clampedIntFrom(impostorRoot.resolution_px, fallback.impostors.resolutionPx, 32, 2048),
        octahedralGridSize: clampedIntFrom(impostorRoot.octahedral_grid_size, fallback.impostors.octahedralGridSize, 1, 8),
        atlasPaddingPx: clampedIntFrom(impostorRoot.atlas_padding_px, fallback.impostors.atlasPaddingPx, 0, 8),
        alphaTest: clampedNumberFrom(impostorRoot.alpha_test, fallback.impostors.alphaTest, 0, 1),
        frameUpdateDistanceM: clampedNumberFrom(impostorRoot.frame_update_distance_m, fallback.impostors.frameUpdateDistanceM, 0, 32),
        axialBillboard: boolFrom(impostorRoot.axial_billboard, fallback.impostors.axialBillboard),
        preserveVertical: boolFrom(impostorRoot.preserve_vertical, fallback.impostors.preserveVertical),
        maxBakesPerFrame: clampedIntFrom(impostorRoot.max_bakes_per_frame, fallback.impostors.maxBakesPerFrame, 1, 8),
        debugShowFrames: boolFrom(impostorRoot.debug_show_frames, fallback.impostors.debugShowFrames),
        debugFreezeFrame: clampedIntFrom(impostorRoot.debug_freeze_frame, fallback.impostors.debugFreezeFrame, -1, 63),
        futureNormalDepth: boolFrom(impostorRoot.future_normal_depth, fallback.impostors.futureNormalDepth),
      },
      foliage: {
        enabled: boolFrom(foliageRoot.enabled, fallback.foliage.enabled),
        alphaTest: clampedNumberFrom(foliageRoot.alpha_test, fallback.foliage.alphaTest, 0, 1),
        maskResolutionPx: Math.max(1, intFrom(foliageRoot.mask_resolution_px, fallback.foliage.maskResolutionPx)),
        textureAtlasColumns: Math.max(1, intFrom(foliageRoot.texture_atlas_columns, fallback.foliage.textureAtlasColumns)),
        textureAtlasRows: Math.max(1, intFrom(foliageRoot.texture_atlas_rows, fallback.foliage.textureAtlasRows)),
        debugShowAlphaCards: boolFrom(foliageRoot.debug_show_alpha_cards, fallback.foliage.debugShowAlphaCards),
        oak: parseFoliageSpecies(foliageRoot.oak, fallback.foliage.oak),
        pine: parseFoliageSpecies(foliageRoot.pine, fallback.foliage.pine),
      },
      wind: {
        enabled: boolFrom(windRoot.enabled, fallback.wind.enabled),
        direction: parseDirection(windRoot.direction, fallback.wind.direction),
        strength: numberFrom(windRoot.strength, fallback.wind.strength),
        speed: numberFrom(windRoot.speed, fallback.wind.speed),
        gustStrength: numberFrom(windRoot.gust_strength, fallback.wind.gustStrength),
        trunkSwayStrength: numberFrom(windRoot.trunk_sway_strength, fallback.wind.trunkSwayStrength),
        leafFlutterStrength: numberFrom(windRoot.leaf_flutter_strength, fallback.wind.leafFlutterStrength),
      },
      render: {
        alphaTest: clampedNumberFrom(renderRoot.alpha_test, fallback.render.alphaTest, 0, 1),
        castShadows: boolFrom(renderRoot.cast_shadows, fallback.render.castShadows),
        receiveShadows: boolFrom(renderRoot.receive_shadows, fallback.render.receiveShadows),
        depthPrepass: boolFrom(renderRoot.depth_prepass, fallback.render.depthPrepass),
        debugColorByLod: boolFrom(renderRoot.debug_color_by_lod, fallback.render.debugColorByLod),
      },
      gpu: {
        enabled: boolFrom(gpuRoot.enabled, fallback.gpu.enabled),
        preferWebGpu: boolFrom(gpuRoot.prefer_webgpu, fallback.gpu.preferWebGpu),
        fallbackToCpu: boolFrom(gpuRoot.fallback_to_cpu, fallback.gpu.fallbackToCpu),
        scatterEnabled: boolFrom(gpuRoot.scatter_enabled, fallback.gpu.scatterEnabled),
        cullEnabled: boolFrom(gpuRoot.cull_enabled, fallback.gpu.cullEnabled),
        maxVisible: Math.max(0, intFrom(gpuRoot.max_visible, fallback.gpu.maxVisible)),
        workgroupSize: Math.max(1, intFrom(gpuRoot.workgroup_size, fallback.gpu.workgroupSize)),
        readbackVisibleLists: boolFrom(gpuRoot.readback_visible_lists, fallback.gpu.readbackVisibleLists),
        debugForceCpu: boolFrom(gpuRoot.debug_force_cpu, fallback.gpu.debugForceCpu),
        debugShowGpuCounts: boolFrom(gpuRoot.debug_show_gpu_counts, fallback.gpu.debugShowGpuCounts),
        debugValidateAgainstCpu: boolFrom(gpuRoot.debug_validate_against_cpu, fallback.gpu.debugValidateAgainstCpu),
      },
      ecology: {
        enabled: boolFrom(ecologyRoot.enabled, fallback.ecology.enabled),
        density: {
          baseDensity: numberFrom(densityRoot.base_density, fallback.ecology.density.baseDensity),
          forestNoiseScaleM: numberFrom(densityRoot.forest_noise_scale_m, fallback.ecology.density.forestNoiseScaleM),
          forestNoiseStrength: numberFrom(densityRoot.forest_noise_strength, fallback.ecology.density.forestNoiseStrength),
          clearingNoiseScaleM: numberFrom(densityRoot.clearing_noise_scale_m, fallback.ecology.density.clearingNoiseScaleM),
          clearingThreshold: numberFrom(densityRoot.clearing_threshold, fallback.ecology.density.clearingThreshold),
          clearingSoftness: numberFrom(densityRoot.clearing_softness, fallback.ecology.density.clearingSoftness),
          edgeSoftnessM: numberFrom(densityRoot.edge_softness_m, fallback.ecology.density.edgeSoftnessM),
        },
        terrain: {
          lowlandHeightM: numberFrom(terrainRoot.lowland_height_m, fallback.ecology.terrain.lowlandHeightM),
          highlandHeightM: numberFrom(terrainRoot.highland_height_m, fallback.ecology.terrain.highlandHeightM),
          heightFadeM: numberFrom(terrainRoot.height_fade_m, fallback.ecology.terrain.heightFadeM),
          slopeFadeStartY: numberFrom(terrainRoot.slope_fade_start_y, fallback.ecology.terrain.slopeFadeStartY),
          slopeFadeEndY: numberFrom(terrainRoot.slope_fade_end_y, fallback.ecology.terrain.slopeFadeEndY),
          materialWeightPower: numberFrom(terrainRoot.material_weight_power, fallback.ecology.terrain.materialWeightPower),
        },
        clustering: {
          clusterScaleM: numberFrom(clusteringRoot.cluster_scale_m, fallback.ecology.clustering.clusterScaleM),
          clusterStrength: numberFrom(clusteringRoot.cluster_strength, fallback.ecology.clustering.clusterStrength),
          clusterThreshold: numberFrom(clusteringRoot.cluster_threshold, fallback.ecology.clustering.clusterThreshold),
          minSpacingJitter: numberFrom(clusteringRoot.min_spacing_jitter, fallback.ecology.clustering.minSpacingJitter),
        },
        age: {
          youngProbability: numberFrom(ageRoot.young_probability, fallback.ecology.age.youngProbability),
          oldProbability: numberFrom(ageRoot.old_probability, fallback.ecology.age.oldProbability),
          scaleYoung: numberFrom(ageRoot.scale_young, fallback.ecology.age.scaleYoung),
          scaleMature: numberFrom(ageRoot.scale_mature, fallback.ecology.age.scaleMature),
          scaleOld: numberFrom(ageRoot.scale_old, fallback.ecology.age.scaleOld),
          scaleVariation: numberFrom(ageRoot.scale_variation, fallback.ecology.age.scaleVariation),
        },
        speciesZones,
      },
    };
  } catch (error) {
    warn?.(`[trees] failed to parse tree config yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`);
    return cloneTreeSettings(DEFAULT_TREE_SETTINGS);
  }
}

export const parseTreeSettings = parseTreeConfig;

function parseDirection(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return [...fallback];
  return [numberFrom(value[0], fallback[0]), numberFrom(value[1], fallback[1])];
}

function cloneRecord<T>(source: Record<string, T>): Record<string, T> {
  return JSON.parse(JSON.stringify(source)) as Record<string, T>;
}

function cloneTreeImpostorSettings(settings: TreeImpostorSettings): TreeImpostorSettings {
  return { ...settings };
}

function cloneFoliageSettings(settings: TreeFoliageSettings): TreeFoliageSettings {
  return {
    ...settings,
    oak: { ...settings.oak },
    pine: { ...settings.pine },
  };
}

function cloneWindSettings(settings: TreeWindSettings): TreeWindSettings {
  return { ...settings, direction: [...settings.direction] };
}

function cloneEcologySettings(settings: TreeEcologySettings): TreeEcologySettings {
  return {
    enabled: settings.enabled,
    density: { ...settings.density },
    terrain: { ...settings.terrain },
    clustering: { ...settings.clustering },
    age: { ...settings.age },
    speciesZones: cloneRecord(settings.speciesZones) as Record<TreeSpeciesId, TreeSpeciesZoneSettings>,
  };
}

export function cloneTreeSettings(settings: TreeSettings = DEFAULT_TREE_SETTINGS): TreeSettings {
  return {
    ...settings,
    species: cloneRecord(settings.species) as Record<TreeSpeciesId, TreeSpeciesSettings>,
    placement: { ...settings.placement },
    lod: { ...settings.lod, budgets: { ...settings.lod.budgets } },
    impostors: cloneTreeImpostorSettings(settings.impostors),
    foliage: cloneFoliageSettings(settings.foliage),
    wind: cloneWindSettings(settings.wind),
    render: { ...settings.render },
    gpu: { ...settings.gpu },
    ecology: cloneEcologySettings(settings.ecology),
  };
}
