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
  detail_normal_strength: number;
  detail_normal_fade_start_m: number;
  detail_normal_fade_end_m: number;
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
  sky_zenith_color: string;
  sss_color: string;
  sss_strength: number;
  horizon_blend_start_m: number;
  horizon_blend_end_m: number;
  edge_fade_m: number;
}

export interface DeepOceanConfig {
  enabled: boolean;
  start_outside_border_m: number;
  visual_extent_m: number;
  near_grid_size_m: number;
  mid_grid_size_m: number;
  far_grid_size_m: number;
  near_subdivisions: number;
  mid_subdivisions: number;
  far_subdivisions: number;
  ring_inner_band_m: number;
  ring_inner_radial_segments: number;
  ring_outer_radial_segments: number;
  ring_tangential_segments: number;
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
