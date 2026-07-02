export * from "./border_coast_ocean_config_types.js";
export * from "./border_coast_ocean_config_defaults.js";

import { load } from "js-yaml";
import borderCoastOceanYaml from "../../config/border_coast_ocean.yaml?raw";
import type { BorderCoastOceanConfig, BorderOceanGameplayConfig } from "./border_coast_ocean_config_types.js";
import { CONFIG_NAME } from "./border_coast_ocean_config_defaults.js";
import {
  booleanAt,
  colorAt,
  integerAt,
  normalizeTypeWeights,
  numberAt,
  probabilityAt,
  recordAt,
  stringAt,
  validateGameplayRelationships,
} from "./border_coast_ocean_config_helpers.js";

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

export const defaultBorderCoastOceanConfig: BorderCoastOceanConfig = parseBorderCoastOceanConfig(borderCoastOceanYaml);
