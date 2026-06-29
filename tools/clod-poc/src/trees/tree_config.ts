import { load } from "js-yaml";

export type TreeSpeciesId = "oak" | "pine" | "dead";
export type TreeLod = "near" | "mid" | "far" | "impostor";
export type TreeShadowMaxLod = TreeLod | "none";

export const TREE_SPECIES: readonly TreeSpeciesId[] = ["oak", "pine", "dead"] as const;
export const TREE_LODS: readonly TreeLod[] = ["near", "mid", "far", "impostor"] as const;

export interface TreeSpeciesSettings {
  enabled: boolean;
  weight: number;
  minHeightM: number;
  maxHeightM: number;
  trunkHeightM: number;
  trunkRadiusM: number;
  crownRadiusM: number;
  morphology: TreeMorphologySettings;
}

export interface TreeMorphologySettings {
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
  shadowsMaxLod: TreeShadowMaxLod;
  budgets: TreeLodBudgetSettings;
}

export interface TreeLodBudgetSettings {
  nearMaxVertices: number;
  midMaxVertices: number;
  farMaxVertices: number;
  impostorMaxVertices: number;
}

export interface TreeRenderSettings {
  debugColorByLod: boolean;
}

export interface TreeGpuSettings {
  enabled: boolean;
  preferWebGpu: boolean;
  fallbackToCpu: boolean;
  scatterEnabled: boolean;
  cullEnabled: boolean;
  maxVisible: number;
  workgroupSize: 32 | 64 | 128 | 256;
  readbackVisibleLists: boolean;
  debugForceCpu: boolean;
  debugShowGpuCounts: boolean;
  debugValidateAgainstCpu: boolean;
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

export interface TreeWindSettings {
  enabled: boolean;
  direction: [number, number];
  strength: number;
  speed: number;
  gustStrength: number;
  trunkSwayStrength: number;
  leafFlutterStrength: number;
}

export interface TreeDensitySettings {
  baseDensity: number;
  forestNoiseScaleM: number;
  forestNoiseStrength: number;
  clearingNoiseScaleM: number;
  clearingThreshold: number;
  clearingSoftness: number;
  edgeSoftnessM: number;
}

export interface TreeTerrainEcologySettings {
  lowlandHeightM: number;
  highlandHeightM: number;
  heightFadeM: number;
  slopeFadeStartY: number;
  slopeFadeEndY: number;
  materialWeightPower: number;
}

export interface TreeClusteringSettings {
  clusterScaleM: number;
  clusterStrength: number;
  clusterThreshold: number;
  minSpacingJitter: number;
}

export interface TreeAgeSettings {
  youngProbability: number;
  oldProbability: number;
  scaleYoung: number;
  scaleMature: number;
  scaleOld: number;
  scaleVariation: number;
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
  density: TreeDensitySettings;
  terrain: TreeTerrainEcologySettings;
  clustering: TreeClusteringSettings;
  age: TreeAgeSettings;
  speciesZones: Record<TreeSpeciesId, TreeSpeciesZoneSettings>;
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

interface TreeYamlConfig {
  trees?: {
    enabled?: boolean;
    seed?: number;
    distance_m?: number;
    refresh_distance_m?: number;
    max_new_patches_per_frame?: number;
    max_instances?: number;
    gpu?: {
      enabled?: boolean;
      prefer_webgpu?: boolean;
      fallback_to_cpu?: boolean;
      scatter_enabled?: boolean;
      cull_enabled?: boolean;
      max_visible?: number;
      workgroup_size?: number;
      readback_visible_lists?: boolean;
      debug_force_cpu?: boolean;
      debug_show_gpu_counts?: boolean;
      debug_validate_against_cpu?: boolean;
    };
    placement?: {
      spacing_m?: number;
      jitter?: number;
      slope_min_y?: number;
      min_height_m?: number;
      max_height_m?: number;
      min_ground_weight?: number;
      min_spacing_m?: number;
    };
    lod?: {
      near_fraction?: number;
      mid_fraction?: number;
      far_fraction?: number;
      impostor_fraction?: number;
      hysteresis_m?: number;
      crossfade_enabled?: boolean;
      crossfade_band_m?: number;
      dither_enabled?: boolean;
      shadows_max_lod?: unknown;
      budgets?: {
        near_max_vertices?: number;
        mid_max_vertices?: number;
        far_max_vertices?: number;
        impostor_max_vertices?: number;
      };
    };
    impostors?: {
      enabled?: boolean;
      bake_on_start?: boolean;
      fallback_to_placeholder?: boolean;
      source_lod?: unknown;
      resolution_px?: number;
      octahedral_grid_size?: number;
      atlas_padding_px?: number;
      alpha_test?: number;
      frame_update_distance_m?: number;
      axial_billboard?: boolean;
      preserve_vertical?: boolean;
      max_bakes_per_frame?: number;
      debug_show_frames?: boolean;
      debug_freeze_frame?: number;
      future_normal_depth?: boolean;
    };
    wind?: {
      enabled?: boolean;
      direction?: unknown;
      strength?: number;
      speed?: number;
      gust_strength?: number;
      trunk_sway_strength?: number;
      leaf_flutter_strength?: number;
    };
    ecology?: {
      enabled?: boolean;
      density?: {
        base_density?: number;
        forest_noise_scale_m?: number;
        forest_noise_strength?: number;
        clearing_noise_scale_m?: number;
        clearing_threshold?: number;
        clearing_softness?: number;
        edge_softness_m?: number;
      };
      terrain?: {
        lowland_height_m?: number;
        highland_height_m?: number;
        height_fade_m?: number;
        slope_fade_start_y?: number;
        slope_fade_end_y?: number;
        material_weight_power?: number;
      };
      clustering?: {
        cluster_scale_m?: number;
        cluster_strength?: number;
        cluster_threshold?: number;
        min_spacing_jitter?: number;
      };
      age?: {
        young_probability?: number;
        old_probability?: number;
        scale_young?: number;
        scale_mature?: number;
        scale_old?: number;
        scale_variation?: number;
      };
      species_zones?: Partial<Record<TreeSpeciesId, {
        height_preference?: unknown;
        moisture_preference?: number;
        slope_tolerance?: number;
        cluster_bias?: number;
        old_forest_bias?: number;
      }>>;
    };
    foliage?: {
      enabled?: boolean;
      alpha_test?: number;
      mask_resolution_px?: number;
      texture_atlas_columns?: number;
      texture_atlas_rows?: number;
      debug_show_alpha_cards?: boolean;
      oak?: TreeYamlFoliageSpecies;
      pine?: TreeYamlFoliageSpecies;
    };
    species?: Partial<Record<TreeSpeciesId, TreeYamlSpecies>>;
    render?: {
      shadows_near_only?: boolean;
      debug_color_by_lod?: boolean;
    };
  };
}

interface TreeYamlSpecies {
  enabled?: boolean;
  weight?: number;
  min_height_m?: number;
  max_height_m?: number;
  trunk_height_m?: number;
  trunk_radius_m?: number;
  crown_radius_m?: number;
  morphology?: {
    trunk_bend?: number;
    trunk_taper?: number;
    branch_levels?: number;
    primary_branch_count?: number;
    secondary_branch_count?: number;
    branch_spread?: number;
    branch_up_sweep?: number;
    branch_length?: number;
    crown_flattening?: number;
    crown_irregularity?: number;
    leaf_cluster_count?: number;
    leaf_card_count?: number;
  };
}

interface TreeYamlFoliageSpecies {
  card_count_near?: number;
  card_count_mid?: number;
  card_count_far?: number;
  card_width_m?: number;
  card_height_m?: number;
  card_size_variation?: number;
  cluster_spread_m?: number;
  crown_flattening?: number;
  tint_variation?: number;
  edge_noise?: number;
  lobe_count?: number;
  cutout_roundness?: number;
}

export const DEFAULT_TREE_WIND_SETTINGS: TreeWindSettings = {
  enabled: true,
  direction: [0.8, 0.6],
  strength: 0.18,
  speed: 0.9,
  gustStrength: 0.12,
  trunkSwayStrength: 0.45,
  leafFlutterStrength: 0.18,
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
    oak: {
      heightPreference: "low",
      moisturePreference: 0.65,
      slopeTolerance: 0.55,
      clusterBias: 0.75,
      oldForestBias: 0,
    },
    pine: {
      heightPreference: "high",
      moisturePreference: 0.35,
      slopeTolerance: 0.85,
      clusterBias: 0.9,
      oldForestBias: 0,
    },
    dead: {
      heightPreference: "any",
      moisturePreference: 0.45,
      slopeTolerance: 0.75,
      clusterBias: 1.0,
      oldForestBias: 0.85,
    },
  },
};

// Foliage alpha cards disabled: procedural grammar trees generate real branch/leaf
// geometry, making billboard cards redundant.  Re-enable when switching to a
// billboard-based foliage representation.
export const DEFAULT_TREE_FOLIAGE_SETTINGS: TreeFoliageSettings = {
  enabled: false,
  alphaTest: 0,
  maskResolutionPx: 64,
  textureAtlasColumns: 4,
  textureAtlasRows: 2,
  debugShowAlphaCards: false,
  oak: {
    cardCountNear: 96,
    cardCountMid: 44,
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
    cardCountNear: 88,
    cardCountMid: 38,
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

// Impostor atlas budget at defaults: 8x8 tiles * 128px = 1024px atlas.
// Two RGBA8 atlases (albedo+coverage and normal+depth) cost ~8 MiB/species,
// ~24 MiB for the current 3 species, keeping the WebGPU perf path reasonable.
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

export const DEFAULT_TREE_GPU_SETTINGS: TreeGpuSettings = {
  enabled: false,
  preferWebGpu: true,
  fallbackToCpu: true,
  scatterEnabled: true,
  cullEnabled: true,
  maxVisible: 50_000,
  workgroupSize: 64,
  readbackVisibleLists: true,
  debugForceCpu: false,
  debugShowGpuCounts: true,
  debugValidateAgainstCpu: false,
};

export const DEFAULT_TREE_SETTINGS: TreeSettings = {
  enabled: true,
  seed: 7331,
  distanceM: 620,
  refreshDistanceM: 16,
  maxNewPatchesPerFrame: 2,
  maxInstances: 9000,
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
    midFraction: 0.242,
    farFraction: 0.742,
    impostorFraction: 1.0,
    hysteresisM: 8,
    crossfadeEnabled: false,
    crossfadeBandM: 0,
    ditherEnabled: false,
    shadowsMaxLod: "near",
    budgets: {
      nearMaxVertices: 260000,
      midMaxVertices: 90000,
      farMaxVertices: 40000,
      impostorMaxVertices: 240,
    },
  },
  wind: {
    ...DEFAULT_TREE_WIND_SETTINGS,
    direction: [...DEFAULT_TREE_WIND_SETTINGS.direction],
... (huge file truncated)