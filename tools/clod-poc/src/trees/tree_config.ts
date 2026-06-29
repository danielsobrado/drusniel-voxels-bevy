import { load } from "js-yaml";
import {
  TREE_EXPANDED_SPECIES,
  TREE_EXPANDED_SPECIES_DEFAULTS,
  TREE_EXPANDED_SPECIES_NICHES,
  type TreeExpandedSpeciesId,
} from "./tree_species_expansion.js";

export type TreeSpeciesId = TreeExpandedSpeciesId;
export type TreeLod = "near" | "mid" | "far" | "impostor";
export type TreeShadowMaxLod = TreeLod | "none";

export const TREE_SPECIES: readonly TreeSpeciesId[] = TREE_EXPANDED_SPECIES;
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

export interface TreeSettings {
  enabled: boolean;
  seed: number;
  distanceM: number;
  refreshDistanceM: number;
  maxNewPatchesPerFrame: number;
  maxInstances: number;
  placement: TreePlacementSettings;
  lod: TreeLodSettings;
  wind: TreeWindSettings;
  ecology: TreeEcologySettings;
  foliage: TreeFoliageSettings;
  impostors: TreeImpostorSettings;
  gpu: TreeGpuSettings;
  species: Record<TreeSpeciesId, TreeSpeciesSettings>;
  render: TreeRenderSettings;
}

interface TreeYamlSpecies {
  enabled?: boolean;
  weight?: number;
  min_height_m?: number;
  max_height_m?: number;
  trunk_height_m?: number;
  trunk_radius_m?: number;
  crown_radius_m?: number;
  morphology?: Partial<Record<keyof TreeMorphologyYaml, number>>;
}

interface TreeMorphologyYaml {
  trunk_bend: number;
  trunk_taper: number;
  branch_levels: number;
  primary_branch_count: number;
  secondary_branch_count: number;
  branch_spread: number;
  branch_up_sweep: number;
  branch_length: number;
  crown_flattening: number;
  crown_irregularity: number;
  leaf_cluster_count: number;
  leaf_card_count: number;
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

interface TreeYamlConfig {
  trees?: {
    enabled?: boolean;
    seed?: number;
    distance_m?: number;
    refresh_distance_m?: number;
    max_new_patches_per_frame?: number;
    max_instances?: number;
    gpu?: Partial<{
      enabled: boolean;
      prefer_webgpu: boolean;
      fallback_to_cpu: boolean;
      scatter_enabled: boolean;
      cull_enabled: boolean;
      max_visible: number;
      workgroup_size: number;
      readback_visible_lists: boolean;
      debug_force_cpu: boolean;
      debug_show_gpu_counts: boolean;
      debug_validate_against_cpu: boolean;
    }>;
    placement?: Partial<{
      spacing_m: number;
      jitter: number;
      slope_min_y: number;
      min_height_m: number;
      max_height_m: number;
      min_ground_weight: number;
      min_spacing_m: number;
    }>;
    lod?: Partial<{
      near_fraction: number;
      mid_fraction: number;
      far_fraction: number;
      impostor_fraction: number;
      hysteresis_m: number;
      crossfade_enabled: boolean;
      crossfade_band_m: number;
      dither_enabled: boolean;
      shadows_max_lod: unknown;
      budgets: Partial<{
        near_max_vertices: number;
        mid_max_vertices: number;
        far_max_vertices: number;
        impostor_max_vertices: number;
      }>;
    }>;
    impostors?: Partial<{
      enabled: boolean;
      bake_on_start: boolean;
      fallback_to_placeholder: boolean;
      source_lod: unknown;
      resolution_px: number;
      octahedral_grid_size: number;
      atlas_padding_px: number;
      alpha_test: number;
      frame_update_distance_m: number;
      axial_billboard: boolean;
      preserve_vertical: boolean;
      max_bakes_per_frame: number;
      debug_show_frames: boolean;
      debug_freeze_frame: number;
      future_normal_depth: boolean;
    }>;
    wind?: Partial<{
      enabled: boolean;
      direction: unknown;
      strength: number;
      speed: number;
      gust_strength: number;
      trunk_sway_strength: number;
      leaf_flutter_strength: number;
    }>;
    ecology?: Partial<{
      enabled: boolean;
      density: Partial<Record<keyof TreeDensityYaml, number>>;
      terrain: Partial<Record<keyof TreeTerrainYaml, number>>;
      clustering: Partial<Record<keyof TreeClusteringYaml, number>>;
      age: Partial<Record<keyof TreeAgeYaml, number>>;
      species_zones: Partial<Record<TreeSpeciesId, Partial<{
        height_preference: unknown;
        moisture_preference: number;
        slope_tolerance: number;
        cluster_bias: number;
        old_forest_bias: number;
      }>>>;
    }>;
    foliage?: Partial<{
      enabled: boolean;
      alpha_test: number;
      mask_resolution_px: number;
      texture_atlas_columns: number;
      texture_atlas_rows: number;
      debug_show_alpha_cards: boolean;
      oak: TreeYamlFoliageSpecies;
      pine: TreeYamlFoliageSpecies;
    }>;
    species?: Partial<Record<TreeSpeciesId, TreeYamlSpecies>>;
    render?: Partial<{
      debug_color_by_lod: boolean;
      shadows_near_only: boolean;
    }>;
  };
}

interface TreeDensityYaml {
  base_density: number;
  forest_noise_scale_m: number;
  forest_noise_strength: number;
  clearing_noise_scale_m: number;
  clearing_threshold: number;
  clearing_softness: number;
  edge_softness_m: number;
}

interface TreeTerrainYaml {
  lowland_height_m: number;
  highland_height_m: number;
  height_fade_m: number;
  slope_fade_start_y: number;
  slope_fade_end_y: number;
  material_weight_power: number;
}

interface TreeClusteringYaml {
  cluster_scale_m: number;
  cluster_strength: number;
  cluster_threshold: number;
  min_spacing_jitter: number;
}

interface TreeAgeYaml {
  young_probability: number;
  old_probability: number;
  scale_young: number;
  scale_mature: number;
  scale_old: number;
  scale_variation: number;
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
  speciesZones: speciesZonesFromExpandedDefaults(),
};

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
// Two RGBA8 atlases cost about 8 MiB/species, about 24 MiB for 3 species.
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
  wind: { ...DEFAULT_TREE_WIND_SETTINGS, direction: [...DEFAULT_TREE_WIND_SETTINGS.direction] },
  ecology: cloneTreeEcology(DEFAULT_TREE_ECOLOGY_SETTINGS),
  foliage: cloneTreeFoliage(DEFAULT_TREE_FOLIAGE_SETTINGS),
  impostors: { ...DEFAULT_TREE_IMPOSTOR_SETTINGS },
  gpu: { ...DEFAULT_TREE_GPU_SETTINGS },
  species: cloneSpeciesSettingsMap(TREE_EXPANDED_SPECIES_DEFAULTS),
  render: { debugColorByLod: false },
};

export function cloneTreeSettings(settings: TreeSettings = DEFAULT_TREE_SETTINGS): TreeSettings {
  return {
    ...settings,
    placement: { ...settings.placement },
    lod: { ...settings.lod, budgets: { ...settings.lod.budgets } },
    wind: { ...settings.wind, direction: [...settings.wind.direction] },
    ecology: cloneTreeEcology(settings.ecology),
    foliage: cloneTreeFoliage(settings.foliage),
    impostors: { ...settings.impostors },
    gpu: { ...settings.gpu },
    render: { ...settings.render },
    species: cloneSpeciesSettingsMap(settings.species),
  };
}

export function parseTreeConfig(text: string | null | undefined, warn: ((message: string) => void) | null = console.warn): TreeSettings {
  const fallback = cloneTreeSettings();
  if (!text || text.trim() === "") return fallback;
  let rawConfig: TreeYamlConfig;
  try {
    rawConfig = (load(text) ?? {}) as TreeYamlConfig;
  } catch (error) {
    warn?.(`[tree-config] failed to parse config/trees.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
  const raw = rawConfig.trees ?? {};
  const enabled = readBoolean(raw.enabled, fallback.enabled);
  return {
    ...fallback,
    enabled,
    seed: Math.floor(readNumber(raw.seed, fallback.seed)),
    distanceM: readNumberAtLeast(raw.distance_m, fallback.distanceM, 0),
    refreshDistanceM: readNumberAtLeast(raw.refresh_distance_m, fallback.refreshDistanceM, 0.1),
    maxNewPatchesPerFrame: Math.floor(readNumberAtLeast(raw.max_new_patches_per_frame, fallback.maxNewPatchesPerFrame, 1)),
    maxInstances: Math.floor(readNumberAtLeast(raw.max_instances, fallback.maxInstances, 0)),
    placement: readPlacement(raw.placement, fallback.placement),
    lod: readTreeLodSettings(raw.lod, fallback.lod, enabled),
    wind: readTreeWindSettings(raw.wind, fallback.wind),
    ecology: readTreeEcologySettings(raw.ecology, fallback.ecology),
    foliage: readTreeFoliageSettings(raw.foliage, fallback.foliage),
    impostors: readTreeImpostorSettings(raw.impostors, fallback.impostors),
    gpu: readTreeGpuSettings(raw.gpu, fallback.gpu),
    species: readSpeciesSettingsMap(fallback.species, raw.species),
    render: {
      debugColorByLod: readBoolean(raw.render?.debug_color_by_lod, fallback.render.debugColorByLod),
    },
  };
}

function cloneSpecies(species: TreeSpeciesSettings): TreeSpeciesSettings {
  return { ...species, morphology: { ...species.morphology } };
}

function cloneSpeciesSettingsMap(source: Record<TreeSpeciesId, TreeSpeciesSettings>): Record<TreeSpeciesId, TreeSpeciesSettings> {
  return Object.fromEntries(TREE_SPECIES.map((species) => [species, cloneSpecies(source[species])])) as Record<TreeSpeciesId, TreeSpeciesSettings>;
}

function readSpeciesSettingsMap(
  fallback: Record<TreeSpeciesId, TreeSpeciesSettings>,
  raw: Partial<Record<TreeSpeciesId, TreeYamlSpecies>> | undefined,
): Record<TreeSpeciesId, TreeSpeciesSettings> {
  return Object.fromEntries(TREE_SPECIES.map((species) => [species, readSpecies(fallback[species], raw?.[species])])) as Record<TreeSpeciesId, TreeSpeciesSettings>;
}

function speciesZonesFromExpandedDefaults(): Record<TreeSpeciesId, TreeSpeciesZoneSettings> {
  return Object.fromEntries(TREE_SPECIES.map((species) => {
    const niche = TREE_EXPANDED_SPECIES_NICHES[species];
    return [species, {
      heightPreference: niche.heightPreference,
      moisturePreference: niche.moisturePreference,
      slopeTolerance: niche.slopeTolerance,
      clusterBias: niche.clusterBias,
      oldForestBias: niche.oldForestBias,
    }];
  })) as Record<TreeSpeciesId, TreeSpeciesZoneSettings>;
}

function cloneSpeciesZoneMap(source: Record<TreeSpeciesId, TreeSpeciesZoneSettings>): Record<TreeSpeciesId, TreeSpeciesZoneSettings> {
  return Object.fromEntries(TREE_SPECIES.map((species) => [species, { ...source[species] }])) as Record<TreeSpeciesId, TreeSpeciesZoneSettings>;
}

function readSpeciesZoneMap(
  fallback: Record<TreeSpeciesId, TreeSpeciesZoneSettings>,
  raw: Partial<Record<TreeSpeciesId, Partial<{
    height_preference: unknown;
    moisture_preference: number;
    slope_tolerance: number;
    cluster_bias: number;
    old_forest_bias: number;
  }>>> | undefined,
): Record<TreeSpeciesId, TreeSpeciesZoneSettings> {
  return Object.fromEntries(TREE_SPECIES.map((species) => [species, readSpeciesZone(fallback[species], raw?.[species])])) as Record<TreeSpeciesId, TreeSpeciesZoneSettings>;
}

function cloneTreeEcology(ecology: TreeEcologySettings): TreeEcologySettings {
  return {
    ...ecology,
    density: { ...ecology.density },
    terrain: { ...ecology.terrain },
    clustering: { ...ecology.clustering },
    age: { ...ecology.age },
    speciesZones: cloneSpeciesZoneMap(ecology.speciesZones),
  };
}

function cloneTreeFoliage(foliage: TreeFoliageSettings): TreeFoliageSettings {
  return {
    ...foliage,
    oak: { ...foliage.oak },
    pine: { ...foliage.pine },
  };
}

function readPlacement(raw: NonNullable<TreeYamlConfig["trees"]>["placement"], fallback: TreePlacementSettings): TreePlacementSettings {
  return {
    spacingM: readNumberAtLeast(raw?.spacing_m, fallback.spacingM, 0.5),
    jitter: readNumberAtLeast(raw?.jitter, fallback.jitter, 0),
    slopeMinY: readNumber(raw?.slope_min_y, fallback.slopeMinY),
    minHeightM: readNumber(raw?.min_height_m, fallback.minHeightM),
    maxHeightM: readNumber(raw?.max_height_m, fallback.maxHeightM),
    minGroundWeight: readNumberAtLeast(raw?.min_ground_weight, fallback.minGroundWeight, 0),
    minSpacingM: readNumberAtLeast(raw?.min_spacing_m, fallback.minSpacingM, 0),
  };
}

function readTreeGpuSettings(raw: NonNullable<TreeYamlConfig["trees"]>["gpu"], fallback: TreeGpuSettings): TreeGpuSettings {
  return {
    enabled: readBoolean(raw?.enabled, fallback.enabled),
    preferWebGpu: readBoolean(raw?.prefer_webgpu, fallback.preferWebGpu),
    fallbackToCpu: readBoolean(raw?.fallback_to_cpu, fallback.fallbackToCpu),
    scatterEnabled: readBoolean(raw?.scatter_enabled, fallback.scatterEnabled),
    cullEnabled: readBoolean(raw?.cull_enabled, fallback.cullEnabled),
    maxVisible: readIntegerInRange(raw?.max_visible, fallback.maxVisible, 0, 500_000),
    workgroupSize: readTreeGpuWorkgroupSize(raw?.workgroup_size, fallback.workgroupSize),
    readbackVisibleLists: readBoolean(raw?.readback_visible_lists, fallback.readbackVisibleLists),
    debugForceCpu: readBoolean(raw?.debug_force_cpu, fallback.debugForceCpu),
    debugShowGpuCounts: readBoolean(raw?.debug_show_gpu_counts, fallback.debugShowGpuCounts),
    debugValidateAgainstCpu: readBoolean(raw?.debug_validate_against_cpu, fallback.debugValidateAgainstCpu),
  };
}

function readTreeLodSettings(raw: NonNullable<TreeYamlConfig["trees"]>["lod"], fallback: TreeLodSettings, enabled: boolean): TreeLodSettings {
  const lod = {
    nearFraction: readFraction(raw?.near_fraction, fallback.nearFraction),
    midFraction: readFraction(raw?.mid_fraction, fallback.midFraction),
    farFraction: readFraction(raw?.far_fraction, fallback.farFraction),
    impostorFraction: readFraction(raw?.impostor_fraction, fallback.impostorFraction),
    hysteresisM: readNumberAtLeast(raw?.hysteresis_m, fallback.hysteresisM, 0),
    crossfadeEnabled: readBoolean(raw?.crossfade_enabled, fallback.crossfadeEnabled),
    crossfadeBandM: readNumberAtLeast(raw?.crossfade_band_m, fallback.crossfadeBandM, 0),
    ditherEnabled: readBoolean(raw?.dither_enabled, fallback.ditherEnabled),
    shadowsMaxLod: readTreeShadowMaxLod(raw?.shadows_max_lod, fallback.shadowsMaxLod),
    budgets: {
      nearMaxVertices: readPositiveInteger(raw?.budgets?.near_max_vertices, fallback.budgets.nearMaxVertices),
      midMaxVertices: readPositiveInteger(raw?.budgets?.mid_max_vertices, fallback.budgets.midMaxVertices),
      farMaxVertices: readPositiveInteger(raw?.budgets?.far_max_vertices, fallback.budgets.farMaxVertices),
      impostorMaxVertices: readPositiveInteger(raw?.budgets?.impostor_max_vertices, fallback.budgets.impostorMaxVertices),
    },
  };
  if (lod.midFraction < lod.nearFraction) lod.midFraction = lod.nearFraction;
  if (lod.farFraction < lod.midFraction) lod.farFraction = lod.midFraction;
  if (lod.impostorFraction < lod.farFraction) lod.impostorFraction = lod.farFraction;
  if (enabled && lod.impostorFraction < 0.01) lod.impostorFraction = 0.01;
  return lod;
}

function readTreeImpostorSettings(raw: NonNullable<TreeYamlConfig["trees"]>["impostors"], fallback: TreeImpostorSettings): TreeImpostorSettings {
  const gridSize = readIntegerInRange(raw?.octahedral_grid_size, fallback.octahedralGridSize, 2, 8);
  return {
    enabled: readBoolean(raw?.enabled, fallback.enabled),
    bakeOnStart: readBoolean(raw?.bake_on_start, fallback.bakeOnStart),
    fallbackToPlaceholder: readBoolean(raw?.fallback_to_placeholder, fallback.fallbackToPlaceholder),
    sourceLod: readTreeImpostorSourceLod(raw?.source_lod, fallback.sourceLod),
    resolutionPx: readIntegerInRange(raw?.resolution_px, fallback.resolutionPx, 32, 512),
    octahedralGridSize: gridSize,
    atlasPaddingPx: readIntegerInRange(raw?.atlas_padding_px, fallback.atlasPaddingPx, 0, 8),
    alphaTest: readNumberInRange(raw?.alpha_test, fallback.alphaTest, 0, 1),
    frameUpdateDistanceM: readNumberInRange(raw?.frame_update_distance_m, fallback.frameUpdateDistanceM, 0, 32),
    axialBillboard: readBoolean(raw?.axial_billboard, fallback.axialBillboard),
    preserveVertical: readBoolean(raw?.preserve_vertical, fallback.preserveVertical),
    maxBakesPerFrame: readIntegerInRange(raw?.max_bakes_per_frame, fallback.maxBakesPerFrame, 1, 8),
    debugShowFrames: readBoolean(raw?.debug_show_frames, fallback.debugShowFrames),
    debugFreezeFrame: readIntegerInRange(raw?.debug_freeze_frame, fallback.debugFreezeFrame, -1, gridSize * gridSize - 1),
    futureNormalDepth: readBoolean(raw?.future_normal_depth, fallback.futureNormalDepth),
  };
}

function readTreeWindSettings(raw: NonNullable<TreeYamlConfig["trees"]>["wind"], fallback: TreeWindSettings): TreeWindSettings {
  return {
    enabled: readBoolean(raw?.enabled, fallback.enabled),
    direction: readWindDirection(raw?.direction, fallback.direction),
    strength: readNumberAtLeast(raw?.strength, fallback.strength, 0),
    speed: readNumberAtLeast(raw?.speed, fallback.speed, 0),
    gustStrength: readNumberAtLeast(raw?.gust_strength, fallback.gustStrength, 0),
    trunkSwayStrength: readNumberAtLeast(raw?.trunk_sway_strength, fallback.trunkSwayStrength, 0),
    leafFlutterStrength: readNumberAtLeast(raw?.leaf_flutter_strength, fallback.leafFlutterStrength, 0),
  };
}

function readTreeEcologySettings(raw: NonNullable<TreeYamlConfig["trees"]>["ecology"], fallback: TreeEcologySettings): TreeEcologySettings {
  return {
    enabled: readBoolean(raw?.enabled, fallback.enabled),
    density: {
      baseDensity: readNumberInRange(raw?.density?.base_density, fallback.density.baseDensity, 0, 4),
      forestNoiseScaleM: readNumberInRange(raw?.density?.forest_noise_scale_m, fallback.density.forestNoiseScaleM, 4, 1024),
      forestNoiseStrength: readNumberInRange(raw?.density?.forest_noise_strength, fallback.density.forestNoiseStrength, 0, 1),
      clearingNoiseScaleM: readNumberInRange(raw?.density?.clearing_noise_scale_m, fallback.density.clearingNoiseScaleM, 4, 2048),
      clearingThreshold: readNumberInRange(raw?.density?.clearing_threshold, fallback.density.clearingThreshold, 0, 1),
      clearingSoftness: readNumberInRange(raw?.density?.clearing_softness, fallback.density.clearingSoftness, 0.001, 1),
      edgeSoftnessM: readNumberInRange(raw?.density?.edge_softness_m, fallback.density.edgeSoftnessM, 0, 256),
    },
    terrain: {
      lowlandHeightM: readNumberInRange(raw?.terrain?.lowland_height_m, fallback.terrain.lowlandHeightM, -256, 2048),
      highlandHeightM: readNumberInRange(raw?.terrain?.highland_height_m, fallback.terrain.highlandHeightM, -256, 4096),
      heightFadeM: readNumberInRange(raw?.terrain?.height_fade_m, fallback.terrain.heightFadeM, 0.001, 512),
      slopeFadeStartY: readNumberInRange(raw?.terrain?.slope_fade_start_y, fallback.terrain.slopeFadeStartY, 0, 1),
      slopeFadeEndY: readNumberInRange(raw?.terrain?.slope_fade_end_y, fallback.terrain.slopeFadeEndY, 0, 1),
      materialWeightPower: readNumberInRange(raw?.terrain?.material_weight_power, fallback.terrain.materialWeightPower, 0.1, 8),
    },
    clustering: {
      clusterScaleM: readNumberInRange(raw?.clustering?.cluster_scale_m, fallback.clustering.clusterScaleM, 4, 1024),
      clusterStrength: readNumberInRange(raw?.clustering?.cluster_strength, fallback.clustering.clusterStrength, 0, 1),
      clusterThreshold: readNumberInRange(raw?.clustering?.cluster_threshold, fallback.clustering.clusterThreshold, 0, 1),
      minSpacingJitter: readNumberInRange(raw?.clustering?.min_spacing_jitter, fallback.clustering.minSpacingJitter, 0, 1),
    },
    age: {
      youngProbability: readNumberInRange(raw?.age?.young_probability, fallback.age.youngProbability, 0, 1),
      oldProbability: readNumberInRange(raw?.age?.old_probability, fallback.age.oldProbability, 0, 1),
      scaleYoung: readNumberInRange(raw?.age?.scale_young, fallback.age.scaleYoung, 0.1, 3),
      scaleMature: readNumberInRange(raw?.age?.scale_mature, fallback.age.scaleMature, 0.1, 3),
      scaleOld: readNumberInRange(raw?.age?.scale_old, fallback.age.scaleOld, 0.1, 4),
      scaleVariation: readNumberInRange(raw?.age?.scale_variation, fallback.age.scaleVariation, 0, 1),
    },
    speciesZones: readSpeciesZoneMap(fallback.speciesZones, raw?.species_zones),
  };
}

function readTreeFoliageSettings(raw: NonNullable<TreeYamlConfig["trees"]>["foliage"], fallback: TreeFoliageSettings): TreeFoliageSettings {
  return {
    enabled: readBoolean(raw?.enabled, fallback.enabled),
    alphaTest: readNumberInRange(raw?.alpha_test, fallback.alphaTest, 0, 1),
    maskResolutionPx: readIntegerInRange(raw?.mask_resolution_px, fallback.maskResolutionPx, 16, 256),
    textureAtlasColumns: readIntegerInRange(raw?.texture_atlas_columns, fallback.textureAtlasColumns, 1, 8),
    textureAtlasRows: readIntegerInRange(raw?.texture_atlas_rows, fallback.textureAtlasRows, 1, 8),
    debugShowAlphaCards: readBoolean(raw?.debug_show_alpha_cards, fallback.debugShowAlphaCards),
    oak: readSpeciesFoliage(fallback.oak, raw?.oak),
    pine: readSpeciesFoliage(fallback.pine, raw?.pine),
  };
}

function readSpecies(base: TreeSpeciesSettings, raw: TreeYamlSpecies | undefined): TreeSpeciesSettings {
  return {
    enabled: readBoolean(raw?.enabled, base.enabled),
    weight: readNumberAtLeast(raw?.weight, base.weight, 0),
    minHeightM: readNumber(raw?.min_height_m, base.minHeightM),
    maxHeightM: readNumber(raw?.max_height_m, base.maxHeightM),
    trunkHeightM: readNumberAtLeast(raw?.trunk_height_m, base.trunkHeightM, 0.1),
    trunkRadiusM: readNumberAtLeast(raw?.trunk_radius_m, base.trunkRadiusM, 0.01),
    crownRadiusM: readNumberAtLeast(raw?.crown_radius_m, base.crownRadiusM, 0),
    morphology: readMorphology(base.morphology, raw?.morphology),
  };
}

function readMorphology(base: TreeMorphologySettings, raw: TreeYamlSpecies["morphology"]): TreeMorphologySettings {
  return {
    trunkBend: readNumberInRange(raw?.trunk_bend, base.trunkBend, 0, 1.5),
    trunkTaper: readNumberInRange(raw?.trunk_taper, base.trunkTaper, 0, 0.95),
    branchLevels: readIntegerInRange(raw?.branch_levels, base.branchLevels, 0, 4),
    primaryBranchCount: readIntegerInRange(raw?.primary_branch_count, base.primaryBranchCount, 0, 24),
    secondaryBranchCount: readIntegerInRange(raw?.secondary_branch_count, base.secondaryBranchCount, 0, 8),
    branchSpread: readNumberInRange(raw?.branch_spread, base.branchSpread, 0, 2),
    branchUpSweep: readNumberInRange(raw?.branch_up_sweep, base.branchUpSweep, -1, 1.5),
    branchLength: readNumberInRange(raw?.branch_length, base.branchLength, 0, 8),
    crownFlattening: readNumberInRange(raw?.crown_flattening, base.crownFlattening, 0.25, 3),
    crownIrregularity: readNumberInRange(raw?.crown_irregularity, base.crownIrregularity, 0, 1),
    leafClusterCount: readIntegerInRange(raw?.leaf_cluster_count, base.leafClusterCount, 0, 96),
    leafCardCount: readIntegerInRange(raw?.leaf_card_count, base.leafCardCount, 0, 192),
  };
}

function readSpeciesZone(fallback: TreeSpeciesZoneSettings, raw: Partial<{ height_preference: unknown; moisture_preference: number; slope_tolerance: number; cluster_bias: number; old_forest_bias: number }> | undefined): TreeSpeciesZoneSettings {
  return {
    heightPreference: readHeightPreference(raw?.height_preference, fallback.heightPreference),
    moisturePreference: readNumberInRange(raw?.moisture_preference, fallback.moisturePreference, 0, 1),
    slopeTolerance: readNumberInRange(raw?.slope_tolerance, fallback.slopeTolerance, 0, 1),
    clusterBias: readNumberInRange(raw?.cluster_bias, fallback.clusterBias, 0, 2),
    oldForestBias: readNumberInRange(raw?.old_forest_bias, fallback.oldForestBias, 0, 2),
  };
}

function readSpeciesFoliage(fallback: TreeSpeciesFoliageSettings, raw: TreeYamlFoliageSpecies | undefined): TreeSpeciesFoliageSettings {
  return {
    cardCountNear: readIntegerInRange(raw?.card_count_near, fallback.cardCountNear, 0, 256),
    cardCountMid: readIntegerInRange(raw?.card_count_mid, fallback.cardCountMid, 0, 128),
    cardCountFar: readIntegerInRange(raw?.card_count_far, fallback.cardCountFar, 0, 16),
    cardWidthM: readNumberInRange(raw?.card_width_m, fallback.cardWidthM, 0.05, 8),
    cardHeightM: readNumberInRange(raw?.card_height_m, fallback.cardHeightM, 0.05, 8),
    cardSizeVariation: readNumberInRange(raw?.card_size_variation, fallback.cardSizeVariation, 0, 1),
    clusterSpreadM: readNumberInRange(raw?.cluster_spread_m, fallback.clusterSpreadM, 0, 16),
    crownFlattening: readNumberInRange(raw?.crown_flattening, fallback.crownFlattening, 0.25, 3),
    tintVariation: readNumberInRange(raw?.tint_variation, fallback.tintVariation, 0, 1),
    edgeNoise: readNumberInRange(raw?.edge_noise, fallback.edgeNoise, 0, 1),
    lobeCount: readIntegerInRange(raw?.lobe_count, fallback.lobeCount, 1, 16),
    cutoutRoundness: readNumberInRange(raw?.cutout_roundness, fallback.cutoutRoundness, 0, 1),
  };
}

function readTreeGpuWorkgroupSize(value: unknown, fallback: TreeGpuSettings["workgroupSize"]): TreeGpuSettings["workgroupSize"] {
  return value === 32 || value === 64 || value === 128 || value === 256 ? value : fallback;
}

function readTreeShadowMaxLod(value: unknown, fallback: TreeShadowMaxLod): TreeShadowMaxLod {
  return value === "near" || value === "mid" || value === "far" || value === "impostor" || value === "none" ? value : fallback;
}

function readTreeImpostorSourceLod(value: unknown, fallback: TreeImpostorSettings["sourceLod"]): TreeImpostorSettings["sourceLod"] {
  return value === "near" || value === "mid" || value === "far" ? value : fallback;
}

function readWindDirection(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return [...fallback];
  const x = readNumber(value[0], Number.NaN);
  const z = readNumber(value[1], Number.NaN);
  const length = Math.hypot(x, z);
  if (!Number.isFinite(length) || length <= 1e-5) return [...fallback];
  return [x / length, z / length];
}

function readHeightPreference(value: unknown, fallback: TreeSpeciesZoneSettings["heightPreference"]): TreeSpeciesZoneSettings["heightPreference"] {
  return value === "low" || value === "high" || value === "any" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNumberAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

function readNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, readNumber(value, fallback)));
}

function readIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(readNumberInRange(value, fallback, min, max));
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return Math.max(1, Math.floor(readNumberAtLeast(value, fallback, 1)));
}

function readFraction(value: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, readNumber(value, fallback)));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
