import { load } from "js-yaml";
import treesYaml from "../../config/trees.yaml?raw";
import {
  TREE_LODS,
  TREE_SPECIES,
  type TreeEcologySettings,
  type TreeFoliageSettings,
  type TreeGpuSettings,
  type TreeImpostorSettings,
  type TreeLod,
  type TreeLodSettings,
  type TreePlacementSettings,
  type TreeRenderSettings,
  type TreeSettings,
  type TreeSpeciesFoliageSettings,
  type TreeSpeciesId,
  type TreeSpeciesMorphologySettings,
  type TreeSpeciesMorphologyRuntimeSettings,
  type TreeSpeciesSettings,
  type TreeSpeciesZoneSettings,
  type TreeWindSettings,
} from "./tree_config_types.js";
import { DEFAULT_TREE_SETTINGS, cloneTreeSettings } from "./tree_config_defaults.js";

export type WarnHandler = ((message: string) => void) | null;

type TreeConfigRoots = {
  trees: Record<string, unknown>;
  placement: Record<string, unknown>;
  lod: Record<string, unknown>;
  impostors: Record<string, unknown>;
  foliage: Record<string, unknown>;
  wind: Record<string, unknown>;
  render: Record<string, unknown>;
  gpu: Record<string, unknown>;
  terrainVisibility: Record<string, unknown>;
  species: Record<string, unknown>;
  ecology: Record<string, unknown>;
  density: Record<string, unknown>;
  terrain: Record<string, unknown>;
  clustering: Record<string, unknown>;
  age: Record<string, unknown>;
  zones: Record<string, unknown>;
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

function parseDirection(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return [...fallback];
  return [numberFrom(value[0], fallback[0]), numberFrom(value[1], fallback[1])];
}

function readRoots(yamlText: string): TreeConfigRoots {
  const root = record(load(yamlText));
  const trees = record(root.trees);
  const gpu = record(trees.gpu);
  const ecology = record(trees.ecology);

  return {
    trees,
    placement: record(trees.placement),
    lod: record(trees.lod),
    impostors: record(trees.impostors),
    foliage: record(trees.foliage),
    wind: record(trees.wind),
    render: record(trees.render),
    gpu,
    terrainVisibility: record(gpu.terrain_visibility),
    species: record(trees.species),
    ecology,
    density: record(ecology.density),
    terrain: record(ecology.terrain),
    clustering: record(ecology.clustering),
    age: record(ecology.age),
    zones: record(ecology.species_zones),
  };
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

const MORPHOLOGY_RUNTIME_KEYS = new Set([
  "slope_lean",
  "wind_lean",
  "random_lean",
  "exposure_flattening",
  "age_flattening",
  "base_droop",
  "age_droop",
  "moisture_droop",
  "base_stiffness",
]);

class TreeConfigUnknownKeyError extends Error {}

function parseMorphologyRuntime(raw: unknown, fallback: TreeSpeciesMorphologyRuntimeSettings): TreeSpeciesMorphologyRuntimeSettings {
  const src = record(raw);
  for (const key of Object.keys(src)) {
    if (!MORPHOLOGY_RUNTIME_KEYS.has(key)) throw new TreeConfigUnknownKeyError(`unknown morphology_runtime key: ${key}`);
  }
  return {
    slopeLean: numberFrom(src.slope_lean, fallback.slopeLean),
    windLean: numberFrom(src.wind_lean, fallback.windLean),
    randomLean: numberFrom(src.random_lean, fallback.randomLean),
    exposureFlattening: numberFrom(src.exposure_flattening, fallback.exposureFlattening),
    ageFlattening: numberFrom(src.age_flattening, fallback.ageFlattening),
    baseDroop: numberFrom(src.base_droop, fallback.baseDroop),
    ageDroop: numberFrom(src.age_droop, fallback.ageDroop),
    moistureDroop: numberFrom(src.moisture_droop, fallback.moistureDroop),
    baseStiffness: numberFrom(src.base_stiffness, fallback.baseStiffness),
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
    morphologyRuntime: parseMorphologyRuntime(src.morphology_runtime, fallback.morphologyRuntime),
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

function parseSpecies(root: Record<string, unknown>, fallback: TreeSettings): Record<TreeSpeciesId, TreeSpeciesSettings> {
  const species = {} as Record<TreeSpeciesId, TreeSpeciesSettings>;
  for (const id of TREE_SPECIES) species[id] = parseSpeciesSettings(root[id], fallback.species[id]);
  return species;
}

function parseSpeciesZones(root: Record<string, unknown>, fallback: TreeSettings): Record<TreeSpeciesId, TreeSpeciesZoneSettings> {
  const speciesZones = {} as Record<TreeSpeciesId, TreeSpeciesZoneSettings>;
  for (const id of TREE_SPECIES) speciesZones[id] = parseSpeciesZone(root[id], fallback.ecology.speciesZones[id]);
  return speciesZones;
}

function parsePlacement(root: Record<string, unknown>, fallback: TreePlacementSettings): TreePlacementSettings {
  return {
    spacingM: numberFrom(root.spacing_m, fallback.spacingM),
    jitter: numberFrom(root.jitter, fallback.jitter),
    slopeMinY: numberFrom(root.slope_min_y, fallback.slopeMinY),
    minHeightM: numberFrom(root.min_height_m, fallback.minHeightM),
    maxHeightM: numberFrom(root.max_height_m, fallback.maxHeightM),
    minGroundWeight: numberFrom(root.min_ground_weight, fallback.minGroundWeight),
    minSpacingM: numberFrom(root.min_spacing_m, fallback.minSpacingM),
  };
}

function parseLod(root: Record<string, unknown>, fallback: TreeLodSettings): TreeLodSettings {
  return {
    nearFraction: numberFrom(root.near_fraction, fallback.nearFraction),
    midFraction: numberFrom(root.mid_fraction, fallback.midFraction),
    farFraction: numberFrom(root.far_fraction, fallback.farFraction),
    impostorFraction: numberFrom(root.impostor_fraction, fallback.impostorFraction),
    hysteresisM: numberFrom(root.hysteresis_m, fallback.hysteresisM),
    crossfadeEnabled: boolFrom(root.crossfade_enabled, fallback.crossfadeEnabled),
    crossfadeBandM: numberFrom(root.crossfade_band_m, fallback.crossfadeBandM),
    ditherEnabled: boolFrom(root.dither_enabled, fallback.ditherEnabled),
    shadowsMaxLod: shadowLodFrom(root.shadows_max_lod, fallback.shadowsMaxLod),
    budgets: {
      nearMaxVertices: budgetFrom(root, "near_max_vertices", "near", fallback.budgets.nearMaxVertices),
      midMaxVertices: budgetFrom(root, "mid_max_vertices", "mid", fallback.budgets.midMaxVertices),
      farMaxVertices: budgetFrom(root, "far_max_vertices", "far", fallback.budgets.farMaxVertices),
      impostorMaxVertices: budgetFrom(root, "impostor_max_vertices", "impostor", fallback.budgets.impostorMaxVertices),
    },
  };
}

function parseImpostors(root: Record<string, unknown>, fallback: TreeImpostorSettings): TreeImpostorSettings {
  return {
    enabled: boolFrom(root.enabled, fallback.enabled),
    bakeOnStart: boolFrom(root.bake_on_start, fallback.bakeOnStart),
    fallbackToPlaceholder: boolFrom(root.fallback_to_placeholder, fallback.fallbackToPlaceholder),
    swapOnBake: boolFrom(root.swap_on_bake, fallback.swapOnBake),
    sourceLod: impostorSourceLodFrom(root.source_lod, fallback.sourceLod),
    resolutionPx: clampedIntFrom(root.resolution_px, fallback.resolutionPx, 32, 2048),
    octahedralGridSize: clampedIntFrom(root.octahedral_grid_size, fallback.octahedralGridSize, 1, 8),
    atlasPaddingPx: clampedIntFrom(root.atlas_padding_px, fallback.atlasPaddingPx, 0, 8),
    alphaTest: clampedNumberFrom(root.alpha_test, fallback.alphaTest, 0, 1),
    frameUpdateDistanceM: clampedNumberFrom(root.frame_update_distance_m, fallback.frameUpdateDistanceM, 0, 32),
    axialBillboard: boolFrom(root.axial_billboard, fallback.axialBillboard),
    preserveVertical: boolFrom(root.preserve_vertical, fallback.preserveVertical),
    maxBakesPerFrame: clampedIntFrom(root.max_bakes_per_frame, fallback.maxBakesPerFrame, 1, 8),
    debugShowFrames: boolFrom(root.debug_show_frames, fallback.debugShowFrames),
    debugFreezeFrame: clampedIntFrom(root.debug_freeze_frame, fallback.debugFreezeFrame, -1, 63),
    futureNormalDepth: boolFrom(root.future_normal_depth, fallback.futureNormalDepth),
  };
}

function parseFoliage(root: Record<string, unknown>, fallback: TreeFoliageSettings): TreeFoliageSettings {
  return {
    enabled: boolFrom(root.enabled, fallback.enabled),
    alphaTest: clampedNumberFrom(root.alpha_test, fallback.alphaTest, 0, 1),
    maskResolutionPx: Math.max(1, intFrom(root.mask_resolution_px, fallback.maskResolutionPx)),
    textureAtlasColumns: Math.max(1, intFrom(root.texture_atlas_columns, fallback.textureAtlasColumns)),
    textureAtlasRows: Math.max(1, intFrom(root.texture_atlas_rows, fallback.textureAtlasRows)),
    debugShowAlphaCards: boolFrom(root.debug_show_alpha_cards, fallback.debugShowAlphaCards),
    oak: parseFoliageSpecies(root.oak, fallback.oak),
    pine: parseFoliageSpecies(root.pine, fallback.pine),
  };
}

function parseWind(root: Record<string, unknown>, fallback: TreeWindSettings): TreeWindSettings {
  return {
    enabled: boolFrom(root.enabled, fallback.enabled),
    direction: parseDirection(root.direction, fallback.direction),
    strength: numberFrom(root.strength, fallback.strength),
    speed: numberFrom(root.speed, fallback.speed),
    gustStrength: numberFrom(root.gust_strength, fallback.gustStrength),
    trunkSwayStrength: numberFrom(root.trunk_sway_strength, fallback.trunkSwayStrength),
    leafFlutterStrength: numberFrom(root.leaf_flutter_strength, fallback.leafFlutterStrength),
  };
}

function parseRender(root: Record<string, unknown>, fallback: TreeRenderSettings): TreeRenderSettings {
  return {
    alphaTest: clampedNumberFrom(root.alpha_test, fallback.alphaTest, 0, 1),
    castShadows: boolFrom(root.cast_shadows, fallback.castShadows),
    receiveShadows: boolFrom(root.receive_shadows, fallback.receiveShadows),
    depthPrepass: boolFrom(root.depth_prepass, fallback.depthPrepass),
    debugColorByLod: boolFrom(root.debug_color_by_lod, fallback.debugColorByLod),
    farCheapMaterial: boolFrom(root.far_cheap_material, fallback.farCheapMaterial),
    placementDebug: boolFrom(root.placement_debug, fallback.placementDebug),
  };
}

function parseGpu(root: Record<string, unknown>, terrainVisibilityRoot: Record<string, unknown>, fallback: TreeGpuSettings): TreeGpuSettings {
  return {
    enabled: boolFrom(root.enabled, fallback.enabled),
    preferWebGpu: boolFrom(root.prefer_webgpu, fallback.preferWebGpu),
    fallbackToCpu: boolFrom(root.fallback_to_cpu, fallback.fallbackToCpu),
    scatterEnabled: boolFrom(root.scatter_enabled, fallback.scatterEnabled),
    cullEnabled: boolFrom(root.cull_enabled, fallback.cullEnabled),
    maxVisible: Math.max(0, intFrom(root.max_visible, fallback.maxVisible)),
    workgroupSize: Math.max(1, intFrom(root.workgroup_size, fallback.workgroupSize)),
    readbackVisibleLists: boolFrom(root.readback_visible_lists, fallback.readbackVisibleLists),
    debugForceCpu: boolFrom(root.debug_force_cpu, fallback.debugForceCpu),
    debugShowGpuCounts: boolFrom(root.debug_show_gpu_counts, fallback.debugShowGpuCounts),
    debugValidateAgainstCpu: boolFrom(root.debug_validate_against_cpu, fallback.debugValidateAgainstCpu),
    terrainVisibility: {
      enabled: boolFrom(terrainVisibilityRoot.enabled, fallback.terrainVisibility.enabled),
      minDistanceM: Math.max(0, numberFrom(terrainVisibilityRoot.min_distance_m, fallback.terrainVisibility.minDistanceM)),
      sampleCount: clampedIntFrom(terrainVisibilityRoot.sample_count, fallback.terrainVisibility.sampleCount, 1, 16),
      heightMarginM: numberFrom(terrainVisibilityRoot.height_margin_m, fallback.terrainVisibility.heightMarginM),
      crownHeightM: Math.max(0, numberFrom(terrainVisibilityRoot.crown_height_m, fallback.terrainVisibility.crownHeightM)),
    },
  };
}

function parseEcology(roots: TreeConfigRoots, speciesZones: Record<TreeSpeciesId, TreeSpeciesZoneSettings>, fallback: TreeEcologySettings): TreeEcologySettings {
  return {
    enabled: boolFrom(roots.ecology.enabled, fallback.enabled),
    density: {
      baseDensity: numberFrom(roots.density.base_density, fallback.density.baseDensity),
      forestNoiseScaleM: numberFrom(roots.density.forest_noise_scale_m, fallback.density.forestNoiseScaleM),
      forestNoiseStrength: numberFrom(roots.density.forest_noise_strength, fallback.density.forestNoiseStrength),
      clearingNoiseScaleM: numberFrom(roots.density.clearing_noise_scale_m, fallback.density.clearingNoiseScaleM),
      clearingThreshold: numberFrom(roots.density.clearing_threshold, fallback.density.clearingThreshold),
      clearingSoftness: numberFrom(roots.density.clearing_softness, fallback.density.clearingSoftness),
      edgeSoftnessM: numberFrom(roots.density.edge_softness_m, fallback.density.edgeSoftnessM),
    },
    terrain: {
      lowlandHeightM: numberFrom(roots.terrain.lowland_height_m, fallback.terrain.lowlandHeightM),
      highlandHeightM: numberFrom(roots.terrain.highland_height_m, fallback.terrain.highlandHeightM),
      heightFadeM: numberFrom(roots.terrain.height_fade_m, fallback.terrain.heightFadeM),
      slopeFadeStartY: numberFrom(roots.terrain.slope_fade_start_y, fallback.terrain.slopeFadeStartY),
      slopeFadeEndY: numberFrom(roots.terrain.slope_fade_end_y, fallback.terrain.slopeFadeEndY),
      materialWeightPower: numberFrom(roots.terrain.material_weight_power, fallback.terrain.materialWeightPower),
    },
    clustering: {
      clusterScaleM: numberFrom(roots.clustering.cluster_scale_m, fallback.clustering.clusterScaleM),
      clusterStrength: numberFrom(roots.clustering.cluster_strength, fallback.clustering.clusterStrength),
      clusterThreshold: numberFrom(roots.clustering.cluster_threshold, fallback.clustering.clusterThreshold),
      minSpacingJitter: numberFrom(roots.clustering.min_spacing_jitter, fallback.clustering.minSpacingJitter),
    },
    age: {
      youngProbability: numberFrom(roots.age.young_probability, fallback.age.youngProbability),
      oldProbability: numberFrom(roots.age.old_probability, fallback.age.oldProbability),
      scaleYoung: numberFrom(roots.age.scale_young, fallback.age.scaleYoung),
      scaleMature: numberFrom(roots.age.scale_mature, fallback.age.scaleMature),
      scaleOld: numberFrom(roots.age.scale_old, fallback.age.scaleOld),
      scaleVariation: numberFrom(roots.age.scale_variation, fallback.age.scaleVariation),
    },
    speciesZones,
  };
}

export function parseTreeConfig(yamlText = treesYaml, warn: WarnHandler = console.warn): TreeSettings {
  try {
    const roots = readRoots(yamlText);
    const fallback = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    const species = parseSpecies(roots.species, fallback);
    const speciesZones = parseSpeciesZones(roots.zones, fallback);

    return {
      enabled: boolFrom(roots.trees.enabled, fallback.enabled),
      seed: intFrom(roots.trees.seed, fallback.seed),
      distanceM: numberFrom(roots.trees.distance_m, fallback.distanceM),
      refreshDistanceM: numberFrom(roots.trees.refresh_distance_m, fallback.refreshDistanceM),
      maxNewPatchesPerFrame: Math.max(1, intFrom(roots.trees.max_new_patches_per_frame, fallback.maxNewPatchesPerFrame)),
      maxInstances: Math.max(0, intFrom(roots.trees.max_instances, fallback.maxInstances)),
      species,
      placement: parsePlacement(roots.placement, fallback.placement),
      lod: parseLod(roots.lod, fallback.lod),
      impostors: parseImpostors(roots.impostors, fallback.impostors),
      foliage: parseFoliage(roots.foliage, fallback.foliage),
      wind: parseWind(roots.wind, fallback.wind),
      render: parseRender(roots.render, fallback.render),
      gpu: parseGpu(roots.gpu, roots.terrainVisibility, fallback.gpu),
      ecology: parseEcology(roots, speciesZones, fallback.ecology),
    };
  } catch (error) {
    if (error instanceof TreeConfigUnknownKeyError) throw error;
    warn?.(`[trees] failed to parse tree config yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`);
    return cloneTreeSettings(DEFAULT_TREE_SETTINGS);
  }
}

export const parseTreeSettings = parseTreeConfig;
