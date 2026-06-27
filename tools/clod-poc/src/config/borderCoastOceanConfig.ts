import { load } from "js-yaml";
import borderCoastOceanYaml from "../../config/border_coast_ocean.yaml?raw";

export interface WorldBoundsConfig {
  min_x: number;
  max_x: number;
  min_z: number;
  max_z: number;
}

export interface BorderCoastWorldConfig {
  bounds: WorldBoundsConfig;
  water_level: number;
}

export interface CoastBandConfig {
  width_m: number;
  inner_fade_m: number;
  outer_fade_m: number;
  segment_length_m: number;
  coastline_noise_scale: number;
  coastline_noise_strength_m: number;
  corner_rounding_m: number;
}

export interface CoastTypeWeightsConfig {
  sandy_beach: number;
  rocky_beach: number;
  cliff: number;
  cove: number;
  reef: number;
}

export interface BeachConfig {
  min_width_m: number;
  max_width_m: number;
  slope: number;
  dune_height_m: number;
  dune_noise_strength_m: number;
  wet_sand_width_m: number;
  tide_pool_probability: number;
}

export interface CliffConfig {
  min_height_m: number;
  max_height_m: number;
  face_steepness: number;
  erosion_noise_strength_m: number;
  ledge_probability: number;
  cave_mouth_probability: number;
}

export interface RockyCoastConfig {
  rock_scatter_density: number;
  boulder_min_scale: number;
  boulder_max_scale: number;
  sea_stack_probability: number;
}

export interface CoastConfig {
  enabled: boolean;
  seed_offset: number;
  band: CoastBandConfig;
  type_weights: CoastTypeWeightsConfig;
  beach: BeachConfig;
  cliff: CliffConfig;
  rocky: RockyCoastConfig;
}

export interface CoastMaterialsConfig {
  dry_sand: string;
  wet_sand: string;
  shallow_seabed: string;
  dune_grass: string;
  cliff_rock: string;
  beach_rock: string;
}

export interface SurfConfig {
  enabled: boolean;
  beach_foam_width_m: number;
  cliff_foam_width_m: number;
  reef_foam_width_m: number;
  foam_noise_scale: number;
  foam_speed: number;
  shore_wave_height: number;
  shore_choppiness: number;
}

export interface DeepOceanWaveConfig {
  gravity: number;
  grid_k: number;
  active_gpu_waves: number;
  wind_speed: number;
  wind_direction_deg: number;
  height_scale: number;
  choppiness: number;
  coarse_patch_m: number;
  fine_patch_m: number;
  foam_threshold: number;
  foam_power: number;
  foam_intensity: number;
  swell_height_scale: number;
}

export interface DeepOceanShadingConfig {
  deep_color: string;
  shallow_color: string;
  foam_color: string;
  fresnel_power: number;
  fresnel_strength: number;
  reflection_strength: number;
  reflection_distortion: number;
  roughness: number;
  fog_color: string;
  fog_near_m: number;
  fog_far_m: number;
  fog_density: number;
}

export interface DeepOceanConfig {
  enabled: boolean;
  start_outside_border_m: number;
  visual_extent_m: number;
  near_grid_size_m: number;
  far_grid_size_m: number;
  near_subdivisions: number;
  far_subdivisions: number;
  wave: DeepOceanWaveConfig;
  shading: DeepOceanShadingConfig;
}

export interface BorderOceanGameplayConfig {
  soft_pushback_enabled: boolean;
  world_edge_margin_m: number;
  pushback_start_inside_world_m: number;
  pushback_strength: number;
}

export interface BorderCoastOceanDebugConfig {
  show_world_bounds: boolean;
  show_coast_band: boolean;
  show_coast_type: boolean;
  show_page_input_sections: boolean;
  freeze_lod_selection: boolean;
}

export interface BorderCoastOceanConfig {
  world: BorderCoastWorldConfig;
  coast: CoastConfig;
  materials: CoastMaterialsConfig;
  surf: SurfConfig;
  deep_ocean: DeepOceanConfig;
  gameplay: BorderOceanGameplayConfig;
  debug: BorderCoastOceanDebugConfig;
}

const CONFIG_NAME = "Border coast/ocean config";
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) {
    throw new Error(`${CONFIG_NAME}: missing required section '${path}'`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${CONFIG_NAME}: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function numberAt(
  record: Record<string, unknown>,
  key: string,
  path: string,
  min = -Infinity,
  max = Infinity,
): number {
  const value = record[key];
  const field = `${path}.${key}`;
  if (value === undefined) throw new Error(`${CONFIG_NAME}: missing required field '${field}'`);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${CONFIG_NAME}: ${field} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new Error(`${CONFIG_NAME}: ${field} must be in [${min}, ${max}], got ${value}`);
  }
  return value;
}

function integerAt(
  record: Record<string, unknown>,
  key: string,
  path: string,
  min = -Infinity,
  max = Infinity,
): number {
  const value = numberAt(record, key, path, min, max);
  if (!Number.isInteger(value)) {
    throw new Error(`${CONFIG_NAME}: ${path}.${key} must be an integer, got ${value}`);
  }
  return value;
}

function booleanAt(record: Record<string, unknown>, key: string, path: string): boolean {
  const value = record[key];
  const field = `${path}.${key}`;
  if (value === undefined) throw new Error(`${CONFIG_NAME}: missing required field '${field}'`);
  if (typeof value !== "boolean") {
    throw new Error(`${CONFIG_NAME}: ${field} must be boolean`);
  }
  return value;
}

function stringAt(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  const field = `${path}.${key}`;
  if (value === undefined) throw new Error(`${CONFIG_NAME}: missing required field '${field}'`);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${CONFIG_NAME}: ${field} must be a non-empty string`);
  }
  return value;
}

function colorAt(record: Record<string, unknown>, key: string, path: string): string {
  const value = stringAt(record, key, path);
  if (!HEX_COLOR.test(value)) {
    throw new Error(`${CONFIG_NAME}: ${path}.${key} must be a six-digit hex color`);
  }
  return value;
}

function probabilityAt(record: Record<string, unknown>, key: string, path: string): number {
  return Math.min(1, Math.max(0, numberAt(record, key, path)));
}

function normalizeTypeWeights(raw: Record<string, unknown>): CoastTypeWeightsConfig {
  const weights: CoastTypeWeightsConfig = {
    sandy_beach: numberAt(raw, "sandy_beach", "coast.type_weights", 0),
    rocky_beach: numberAt(raw, "rocky_beach", "coast.type_weights", 0),
    cliff: numberAt(raw, "cliff", "coast.type_weights", 0),
    cove: numberAt(raw, "cove", "coast.type_weights", 0),
    reef: numberAt(raw, "reef", "coast.type_weights", 0),
  };
  const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
  if (sum <= 0) {
    throw new Error(`${CONFIG_NAME}: coast.type_weights must contain at least one positive weight`);
  }
  return {
    sandy_beach: weights.sandy_beach / sum,
    rocky_beach: weights.rocky_beach / sum,
    cliff: weights.cliff / sum,
    cove: weights.cove / sum,
    reef: weights.reef / sum,
  };
}

function validateGameplayRelationships(config: BorderOceanGameplayConfig): void {
  if (config.world_edge_margin_m <= 0) {
    throw new Error(`${CONFIG_NAME}: gameplay.world_edge_margin_m must be greater than 0`);
  }
  if (!config.soft_pushback_enabled) return;
  if (config.pushback_start_inside_world_m <= 0) {
    throw new Error(
      `${CONFIG_NAME}: gameplay.pushback_start_inside_world_m must be greater than 0 when soft pushback is enabled`,
    );
  }
  if (config.pushback_strength <= 0) {
    throw new Error(
      `${CONFIG_NAME}: gameplay.pushback_strength must be greater than 0 when soft pushback is enabled`,
    );
  }
}

export function parseBorderCoastOceanConfig(text: string): BorderCoastOceanConfig {
  let parsed: unknown;
  try {
    parsed = load(text);
  } catch (error) {
    throw new Error(
      `${CONFIG_NAME}: malformed YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const root = recordAt(parsed, "root");
  const world = recordAt(root["world"], "world");
  const bounds = recordAt(world["bounds"], "world.bounds");
  const coast = recordAt(root["coast"], "coast");
  const band = recordAt(coast["band"], "coast.band");
  const typeWeights = recordAt(coast["type_weights"], "coast.type_weights");
  const beach = recordAt(coast["beach"], "coast.beach");
  const cliff = recordAt(coast["cliff"], "coast.cliff");
  const rocky = recordAt(coast["rocky"], "coast.rocky");
  const materials = recordAt(root["materials"], "materials");
  const surf = recordAt(root["surf"], "surf");
  const deepOcean = recordAt(root["deep_ocean"], "deep_ocean");
  const wave = recordAt(deepOcean["wave"], "deep_ocean.wave");
  const shading = recordAt(deepOcean["shading"], "deep_ocean.shading");
  const gameplay = recordAt(root["gameplay"], "gameplay");
  const debug = recordAt(root["debug"], "debug");

  const minX = numberAt(bounds, "min_x", "world.bounds");
  const maxX = numberAt(bounds, "max_x", "world.bounds");
  const minZ = numberAt(bounds, "min_z", "world.bounds");
  const maxZ = numberAt(bounds, "max_z", "world.bounds");
  if (minX >= maxX) {
    throw new Error(`${CONFIG_NAME}: world.bounds.min_x must be less than world.bounds.max_x`);
  }
  if (minZ >= maxZ) {
    throw new Error(`${CONFIG_NAME}: world.bounds.min_z must be less than world.bounds.max_z`);
  }

  const beachMinWidth = numberAt(beach, "min_width_m", "coast.beach", 0);
  const beachMaxWidth = numberAt(beach, "max_width_m", "coast.beach", 0);
  if (beachMinWidth > beachMaxWidth) {
    throw new Error(`${CONFIG_NAME}: coast.beach.min_width_m must not exceed coast.beach.max_width_m`);
  }

  const cliffMinHeight = numberAt(cliff, "min_height_m", "coast.cliff", 0);
  const cliffMaxHeight = numberAt(cliff, "max_height_m", "coast.cliff", 0);
  if (cliffMinHeight > cliffMaxHeight) {
    throw new Error(`${CONFIG_NAME}: coast.cliff.min_height_m must not exceed coast.cliff.max_height_m`);
  }

  const boulderMinScale = numberAt(rocky, "boulder_min_scale", "coast.rocky", Number.MIN_VALUE);
  const boulderMaxScale = numberAt(rocky, "boulder_max_scale", "coast.rocky", Number.MIN_VALUE);
  if (boulderMinScale > boulderMaxScale) {
    throw new Error(`${CONFIG_NAME}: coast.rocky.boulder_min_scale must not exceed coast.rocky.boulder_max_scale`);
  }

  const nearGridSize = numberAt(deepOcean, "near_grid_size_m", "deep_ocean", Number.MIN_VALUE);
  const farGridSize = numberAt(deepOcean, "far_grid_size_m", "deep_ocean", Number.MIN_VALUE);
  if (nearGridSize > farGridSize) {
    throw new Error(`${CONFIG_NAME}: deep_ocean.near_grid_size_m must not exceed deep_ocean.far_grid_size_m`);
  }

  const fogNear = numberAt(shading, "fog_near_m", "deep_ocean.shading", 0);
  const fogFar = numberAt(shading, "fog_far_m", "deep_ocean.shading", 0);
  if (fogNear >= fogFar) {
    throw new Error(`${CONFIG_NAME}: deep_ocean.shading.fog_near_m must be less than fog_far_m`);
  }

  const gameplayConfig: BorderOceanGameplayConfig = {
    soft_pushback_enabled: booleanAt(gameplay, "soft_pushback_enabled", "gameplay"),
    world_edge_margin_m: numberAt(gameplay, "world_edge_margin_m", "gameplay", 0),
    pushback_start_inside_world_m: numberAt(gameplay, "pushback_start_inside_world_m", "gameplay", 0),
    pushback_strength: numberAt(gameplay, "pushback_strength", "gameplay", 0),
  };
  validateGameplayRelationships(gameplayConfig);

  return {
    world: {
      bounds: { min_x: minX, max_x: maxX, min_z: minZ, max_z: maxZ },
      water_level: numberAt(world, "water_level", "world"),
    },
    coast: {
      enabled: booleanAt(coast, "enabled", "coast"),
      seed_offset: integerAt(coast, "seed_offset", "coast"),
      band: {
        width_m: numberAt(band, "width_m", "coast.band", Number.MIN_VALUE),
        inner_fade_m: numberAt(band, "inner_fade_m", "coast.band", 0),
        outer_fade_m: numberAt(band, "outer_fade_m", "coast.band", 0),
        segment_length_m: numberAt(band, "segment_length_m", "coast.band", Number.MIN_VALUE),
        coastline_noise_scale: numberAt(band, "coastline_noise_scale", "coast.band", Number.MIN_VALUE),
        coastline_noise_strength_m: numberAt(band, "coastline_noise_strength_m", "coast.band", 0),
        corner_rounding_m: numberAt(band, "corner_rounding_m", "coast.band", 0),
      },
      type_weights: normalizeTypeWeights(typeWeights),
      beach: {
        min_width_m: beachMinWidth,
        max_width_m: beachMaxWidth,
        slope: numberAt(beach, "slope", "coast.beach", 0),
        dune_height_m: numberAt(beach, "dune_height_m", "coast.beach", 0),
        dune_noise_strength_m: numberAt(beach, "dune_noise_strength_m", "coast.beach", 0),
        wet_sand_width_m: numberAt(beach, "wet_sand_width_m", "coast.beach", 0),
        tide_pool_probability: probabilityAt(beach, "tide_pool_probability", "coast.beach"),
      },
      cliff: {
        min_height_m: cliffMinHeight,
        max_height_m: cliffMaxHeight,
        face_steepness: numberAt(cliff, "face_steepness", "coast.cliff", 0, 1),
        erosion_noise_strength_m: numberAt(cliff, "erosion_noise_strength_m", "coast.cliff", 0),
        ledge_probability: probabilityAt(cliff, "ledge_probability", "coast.cliff"),
        cave_mouth_probability: probabilityAt(cliff, "cave_mouth_probability", "coast.cliff"),
      },
      rocky: {
        rock_scatter_density: numberAt(rocky, "rock_scatter_density", "coast.rocky", 0),
        boulder_min_scale: boulderMinScale,
        boulder_max_scale: boulderMaxScale,
        sea_stack_probability: probabilityAt(rocky, "sea_stack_probability", "coast.rocky"),
      },
    },
    materials: {
      dry_sand: stringAt(materials, "dry_sand", "materials"),
      wet_sand: stringAt(materials, "wet_sand", "materials"),
      shallow_seabed: stringAt(materials, "shallow_seabed", "materials"),
      dune_grass: stringAt(materials, "dune_grass", "materials"),
      cliff_rock: stringAt(materials, "cliff_rock", "materials"),
      beach_rock: stringAt(materials, "beach_rock", "materials"),
    },
    surf: {
      enabled: booleanAt(surf, "enabled", "surf"),
      beach_foam_width_m: numberAt(surf, "beach_foam_width_m", "surf", 0),
      cliff_foam_width_m: numberAt(surf, "cliff_foam_width_m", "surf", 0),
      reef_foam_width_m: numberAt(surf, "reef_foam_width_m", "surf", 0),
      foam_noise_scale: numberAt(surf, "foam_noise_scale", "surf", Number.MIN_VALUE),
      foam_speed: numberAt(surf, "foam_speed", "surf", 0),
      shore_wave_height: numberAt(surf, "shore_wave_height", "surf", 0),
      shore_choppiness: numberAt(surf, "shore_choppiness", "surf", 0),
    },
    deep_ocean: {
      enabled: booleanAt(deepOcean, "enabled", "deep_ocean"),
      start_outside_border_m: numberAt(deepOcean, "start_outside_border_m", "deep_ocean", 0),
      visual_extent_m: numberAt(deepOcean, "visual_extent_m", "deep_ocean", Number.MIN_VALUE),
      near_grid_size_m: nearGridSize,
      far_grid_size_m: farGridSize,
      near_subdivisions: integerAt(deepOcean, "near_subdivisions", "deep_ocean", 1),
      far_subdivisions: integerAt(deepOcean, "far_subdivisions", "deep_ocean", 1),
      wave: {
        gravity: numberAt(wave, "gravity", "deep_ocean.wave", Number.MIN_VALUE),
        grid_k: integerAt(wave, "grid_k", "deep_ocean.wave", 2),
        active_gpu_waves: integerAt(wave, "active_gpu_waves", "deep_ocean.wave", 1),
        wind_speed: numberAt(wave, "wind_speed", "deep_ocean.wave", 0),
        wind_direction_deg: numberAt(wave, "wind_direction_deg", "deep_ocean.wave"),
        height_scale: numberAt(wave, "height_scale", "deep_ocean.wave", 0),
        choppiness: numberAt(wave, "choppiness", "deep_ocean.wave", 0),
        coarse_patch_m: numberAt(wave, "coarse_patch_m", "deep_ocean.wave", Number.MIN_VALUE),
        fine_patch_m: numberAt(wave, "fine_patch_m", "deep_ocean.wave", Number.MIN_VALUE),
        foam_threshold: numberAt(wave, "foam_threshold", "deep_ocean.wave", 0, 1),
        foam_power: numberAt(wave, "foam_power", "deep_ocean.wave", 0),
        foam_intensity: numberAt(wave, "foam_intensity", "deep_ocean.wave", 0),
        swell_height_scale: numberAt(wave, "swell_height_scale", "deep_ocean.wave", 0),
      },
      shading: {
        deep_color: colorAt(shading, "deep_color", "deep_ocean.shading"),
        shallow_color: colorAt(shading, "shallow_color", "deep_ocean.shading"),
        foam_color: colorAt(shading, "foam_color", "deep_ocean.shading"),
        fresnel_power: numberAt(shading, "fresnel_power", "deep_ocean.shading", 0),
        fresnel_strength: numberAt(shading, "fresnel_strength", "deep_ocean.shading", 0),
        reflection_strength: numberAt(shading, "reflection_strength", "deep_ocean.shading", 0),
        reflection_distortion: numberAt(shading, "reflection_distortion", "deep_ocean.shading", 0),
        roughness: numberAt(shading, "roughness", "deep_ocean.shading", 0, 1),
        fog_color: colorAt(shading, "fog_color", "deep_ocean.shading"),
        fog_near_m: fogNear,
        fog_far_m: fogFar,
        fog_density: numberAt(shading, "fog_density", "deep_ocean.shading", 0),
      },
    },
    gameplay: gameplayConfig,
    debug: {
      show_world_bounds: booleanAt(debug, "show_world_bounds", "debug"),
      show_coast_band: booleanAt(debug, "show_coast_band", "debug"),
      show_coast_type: booleanAt(debug, "show_coast_type", "debug"),
      show_page_input_sections: booleanAt(debug, "show_page_input_sections", "debug"),
      freeze_lod_selection: booleanAt(debug, "freeze_lod_selection", "debug"),
    },
  };
}

export const defaultBorderCoastOceanConfig = parseBorderCoastOceanConfig(borderCoastOceanYaml);
