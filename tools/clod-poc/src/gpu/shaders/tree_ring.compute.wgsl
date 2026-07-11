const TREE_WORKGROUP_SIZE: u32 = 64u;
const TREE_LOD_NEAR: u32 = 0u;
const TREE_LOD_MID: u32 = 1u;
const TREE_LOD_FAR: u32 = 2u;
const TREE_LOD_IMPOSTOR: u32 = 3u;
const TREE_LOD_COUNT: u32 = 4u;
const TREE_SPECIES_COUNT: u32 = 6u;
const TREE_GROUP_COUNT: u32 = TREE_SPECIES_COUNT * TREE_LOD_COUNT;
const TREE_SHADOW_CASCADE_COUNT: u32 = 4u;
const TREE_SHADOW_PLANE_COUNT: u32 = 6u;
const TREE_SHADOW_GROUP_COUNT: u32 = TREE_GROUP_COUNT * TREE_SHADOW_CASCADE_COUNT;
const TREE_INDIRECT_STRIDE_U32: u32 = 5u;
const TREE_TERRAIN_HIDDEN_COUNTER: u32 = TREE_SHADOW_GROUP_COUNT;
const TREE_TERRAIN_VISIBLE_COUNTER: u32 = TREE_SHADOW_GROUP_COUNT + 1u;
const TREE_HYDRO_WATER_CLEARANCE: f32 = 1.5;
const TREE_RIPARIAN_INNER_END_M: f32 = 8.0;
const TREE_RIPARIAN_OUTER_START_M: f32 = 9.0;
const TREE_RIPARIAN_OUTER_END_M: f32 = 32.0;

struct TreeAcceptParams {
  seed: u32,
  min_height_m: f32,
  max_height_m: f32,
  slope_min_y: f32,
  min_ground_weight: f32,
  lowland_height_m: f32,
  highland_height_m: f32,
  height_fade_m: f32,
  slope_fade_start_y: f32,
  slope_fade_end_y: f32,
  material_weight_power: f32,
  base_density: f32,
  parent_cell_m: f32,
  clump_strength: f32,
  clump_threshold: f32,
  water_clearance_m: f32,
  rock_reject: f32,
  snow_reject: f32,
  material_density: vec4<f32>,
};

struct TreeLodParams {
  near_m: f32,
  mid_m: f32,
  far_m: f32,
  radius_m: f32,
  band_m: f32,
};

struct TreeLodRing {
  lod_active: vec4<u32>,
  fade: vec4<f32>,
};

struct TreeRingParams {
  center_radius: vec4<f32>,
  lod: vec4<f32>,
  settings_a: vec4<f32>,
  settings_b: vec4<f32>,
  settings_c: vec4<f32>,
  settings_d: vec4<f32>,
  settings_e: vec4<f32>,
  species_weights_a: vec4<f32>,
  species_weights_b: vec4<f32>,
  terrain_visibility: vec4<f32>,
  terrain_visibility_u: vec4<u32>,
  index_counts_a: vec4<u32>,
  index_counts_b: vec4<u32>,
  index_counts_c: vec4<u32>,
  index_counts_d: vec4<u32>,
  index_counts_e: vec4<u32>,
  index_counts_f: vec4<u32>,
  settings_u: vec4<u32>,
  material_density: vec4<f32>,
  species_material_oak: vec4<f32>,
  species_material_pine: vec4<f32>,
  species_material_dead: vec4<f32>,
  species_material_birch: vec4<f32>,
  species_material_willow: vec4<f32>,
  species_material_spruce: vec4<f32>,
  planes: array<vec4<f32>, 6>,
  shadow_planes: array<vec4<f32>, 24>,
  hydro_atlas: vec4<f32>,
};

struct TreeHydrologySample {
  water_y: f32,
  wet_mask: f32,
  carved_bed: f32,
  enabled: f32,
};

@group(0) @binding(0) var<uniform> params: TreeRingParams;
@group(0) @binding(1) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indirect_args: array<u32>;
@group(0) @binding(3) var<storage, read_write> out_cell: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> shadow_counters: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> shadow_indirect_args: array<u32>;
@group(0) @binding(6) var<storage, read_write> out_shadow_cell: array<vec4<f32>>;
@group(0) @binding(9) var hydro_texture: texture_2d<f32>;
@group(0) @binding(10) var hydro_sampler: sampler;
@group(0) @binding(13) var hydro_atlas_texture: texture_2d<f32>;

fn placement_hydro_atlas_params() -> vec4<f32> {
  return params.hydro_atlas;
}

fn tree_pcg2d(cell: vec2<f32>, salt: u32) -> vec2<f32> {
  let M = 1664525u;
  let C = 1013904223u;
  let a0 = u32(cell.x + 40000.0 + f32(salt & 0x3fffu));
  let b0 = u32(cell.y + 40000.0 + f32((salt >> 14u) & 0x3fffu));
  let a1 = a0 * M + C;
  let b1 = b0 * M + C;
  let a2 = a1 + b1 * M;
  let b2 = b1 + a2 * M;
  let a3 = a2 ^ (a2 >> 16u);
  let b3 = b2 ^ (b2 >> 16u);
  let a4 = a3 + b3 * M;
  let b4 = b3 + a4 * M;
  let a5 = a4 ^ (a4 >> 16u);
  let b5 = b4 ^ (b4 >> 16u);
  let inv = 1.0 / 16777216.0;
  return vec2<f32>(f32(a5 & 0xffffffu) * inv, f32(b5 & 0xffffffu) * inv);
}

fn tree_hash(cell: vec2<f32>, salt: u32) -> f32 {
  let seed = f32(params.settings_u.z);
  let salt_f = f32(salt);
  return fract(sin(dot(cell + vec2<f32>(seed + salt_f, seed * 0.37 + salt_f * 1.17), vec2<f32>(41.3, 289.1))) * 43758.5453);
}

fn tree_hash2(cell: vec2<f32>, salt: u32) -> vec2<f32> {
  return vec2<f32>(tree_hash(cell, salt), tree_hash(cell, salt + 97u));
}

fn tree_world_cell(slot_x: u32, slot_z: u32, grid: u32, cell_size: f32, camera_xz: vec2<f32>) -> vec2<f32> {
  let safe_grid = max(grid, 1u);
  let safe_cell = max(cell_size, 0.001);
  let sx = f32(slot_x);
  let sz = f32(slot_z);
  let cam_cell = camera_xz / safe_cell;
  return vec2<f32>(
    round((cam_cell.x - sx) / f32(safe_grid)) * f32(safe_grid) + sx,
    round((cam_cell.y - sz) / f32(safe_grid)) * f32(safe_grid) + sz,
  );
}

fn tree_world_cell_from_slot(slot: u32, grid: u32, cell_size: f32, camera_xz: vec2<f32>) -> vec2<f32> {
  let safe_grid = max(grid, 1u);
  return tree_world_cell(slot % safe_grid, slot / safe_grid, safe_grid, cell_size, camera_xz);
}

fn tree_hydrology_at(wx: f32, wz: f32) -> TreeHydrologySample {
  let dims = textureDimensions(hydro_texture);
  if (dims.x <= 1u || dims.y <= 1u) {
    return TreeHydrologySample(0.0, 0.0, 0.0, 0.0);
  }
  let world_size = max(1.0, params.center_radius.w);
  if (!placement_inside_startup_world(wx, wz, world_size) && placement_hydro_atlas_enabled()) {
    let atlas = placement_sample_hydro_atlas(wx, wz);
    if (!placement_hydro_sample_valid(atlas)) {
      return TreeHydrologySample(0.0, 0.0, 0.0, 0.0);
    }
    return TreeHydrologySample(atlas.x, atlas.y, atlas.z, 1.0);
  }
  let uv = clamp(vec2<f32>(wx, wz) / world_size, vec2<f32>(0.0), vec2<f32>(1.0));
  let h = textureSampleLevel(hydro_texture, hydro_sampler, uv, 0.0);
  return TreeHydrologySample(h.x, h.y, h.z, 1.0);
}

fn tree_hydrology_ground_height(raw_height: f32, sample: TreeHydrologySample) -> f32 {
  if (sample.enabled < 0.5) { return raw_height; }
  return sample.carved_bed;
}

fn tree_hydrology_reject_tree(sample: TreeHydrologySample, ground_height: f32, cfg: TreeAcceptParams) -> bool {
  if (sample.enabled < 0.5 || sample.wet_mask <= 0.05) { return false; }
  return ground_height <= sample.water_y + max(TREE_HYDRO_WATER_CLEARANCE, cfg.water_clearance_m);
}

fn tree_hydrology_bank_density_mask(sample: TreeHydrologySample, ground_height: f32, normal_y: f32, cfg: TreeAcceptParams) -> f32 {
  if (sample.enabled < 0.5 || sample.wet_mask <= 0.001) { return 1.0; }
  let above_water = ground_height - sample.water_y;
  let clear_distance = max(TREE_HYDRO_WATER_CLEARANCE, cfg.water_clearance_m);
  let clear_of_channel = smoothstep(clear_distance, clear_distance + 2.5, above_water);
  let sparse_inner_bank = smoothstep(clear_distance + 1.0, clear_distance + 3.5, above_water)
    * (1.0 - smoothstep(TREE_RIPARIAN_INNER_END_M, TREE_RIPARIAN_INNER_END_M + 5.0, above_water));
  let riparian_outer_bank = smoothstep(TREE_RIPARIAN_OUTER_START_M, TREE_RIPARIAN_OUTER_START_M + 5.0, above_water)
    * (1.0 - smoothstep(TREE_RIPARIAN_OUTER_END_M, TREE_RIPARIAN_OUTER_END_M + 12.0, above_water));
  let slope_health = smoothstep(cfg.slope_fade_start_y, cfg.slope_fade_end_y, normal_y);
  let sparse_density = mix(1.0, 0.58, sparse_inner_bank);
  let riparian_density = mix(1.0, 1.20, riparian_outer_bank * slope_health);
  return clamp(clear_of_channel * sparse_density * riparian_density, 0.0, 1.20);
}

fn tree_hydrology_scale_mask(sample: TreeHydrologySample, ground_height: f32) -> f32 {
  if (sample.enabled < 0.5 || sample.wet_mask <= 0.001) { return 1.0; }
  let above_water = ground_height - sample.water_y;
  let low_inner = smoothstep(2.2, 5.0, above_water) * (1.0 - smoothstep(7.5, 14.0, above_water));
  return clamp(mix(1.0, 0.84, low_inner), 0.82, 1.0);
}

fn tree_material_weights(height: f32, normal_y: f32) -> vec4<f32> {
  _ = normal_y;
  let sand = max(0.0, 1.0 - abs(height - WATER_LEVEL) / 6.0);
  let snow = max(0.0, (height - 88.0) / 22.0);
  let rock = clamp((height - 48.0) / 34.0, 0.0, 1.0) * (1.0 - snow);
  let grass = max(0.0, 1.0 - sand - snow - rock);
  let sum = max(1e-5, grass + rock + sand + snow);
  return vec4<f32>(grass, rock, sand, snow) / sum;
}

fn tree_parent_clump_mask(wpos: vec2<f32>, cfg: TreeAcceptParams) -> f32 {
  let parent_cell = max(0.001, cfg.parent_cell_m);
  let parent = floor(wpos / parent_cell);
  let parent_hash = tree_pcg2d(parent, cfg.seed + 13001u).x;
  let clump = smoothstep(cfg.clump_threshold, 1.0, parent_hash);
  let clustered_density = clamp(0.12 + clump * 1.35, 0.0, 1.25);
  return clamp(1.0 - cfg.clump_strength + clustered_density * cfg.clump_strength, 0.0, 1.25);
}

fn tree_forest_cover_mask(wpos: vec2<f32>, cfg: TreeAcceptParams) -> f32 {
  let broad_cell = floor(wpos / 176.0);
  let mid_cell = floor(wpos / 64.0);
  let broad = tree_pcg2d(broad_cell, cfg.seed + 17011u).x;
  let mid = tree_pcg2d(mid_cell, cfg.seed + 19031u).y;
  let clearing = smoothstep(0.62, 0.92, broad) * smoothstep(0.44, 0.86, mid);
  return clamp(1.0 - clearing * 0.78, 0.18, 1.0);
}

fn tree_shoreline_density_mask(height: f32, normal_y: f32, cfg: TreeAcceptParams) -> f32 {
  let water_margin = height - WATER_LEVEL;
  let dry_bank = smoothstep(cfg.water_clearance_m, cfg.water_clearance_m + 7.0, water_margin);
  let lowland_moisture = 1.0 - clamp(water_margin / 36.0, 0.0, 1.0);
  let bank_health = smoothstep(cfg.slope_fade_start_y, cfg.slope_fade_end_y, normal_y);
  let riparian_boost = mix(0.92, 1.18, lowland_moisture * bank_health);
  return clamp(dry_bank * riparian_boost, 0.0, 1.18);
}

fn tree_local_competition_mask(wc: vec2<f32>, wpos: vec2<f32>, cfg: TreeAcceptParams) -> f32 {
  let current = tree_hash(wc, 7103u) + tree_parent_clump_mask(wpos, cfg) * 0.08;
  var stronger_neighbors = 0.0;
  for (var dz = -1; dz <= 1; dz = dz + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      if (dx != 0 || dz != 0) {
        let ncell = wc + vec2<f32>(f32(dx), f32(dz));
        let nscore = tree_hash(ncell, 7103u) + tree_hash(ncell, 7201u) * 0.08;
        stronger_neighbors = stronger_neighbors + select(0.0, 1.0, nscore > current + 0.18);
      }
    }
  }
  let pressure = clamp(stronger_neighbors / 8.0, 0.0, 1.0);
  return mix(1.05, 0.72, pressure);
}

fn tree_height_normal_y(wpos: vec2<f32>) -> f32 {
  let e = max(params.settings_a.x, 1.0);
  let hx0 = placement_ground_height(wpos.x - e, wpos.y, params.center_radius.w);
  let hx1 = placement_ground_height(wpos.x + e, wpos.y, params.center_radius.w);
  let hz0 = placement_ground_height(wpos.x, wpos.y - e, params.center_radius.w);
  let hz1 = placement_ground_height(wpos.x, wpos.y + e, params.center_radius.w);
  return normalize(vec3<f32>(hx0 - hx1, e * 2.0, hz0 - hz1)).y;
}

fn tree_accept_mask(height: f32, normal_y: f32, wpos: vec2<f32>, cfg: TreeAcceptParams) -> f32 {
  if (height < cfg.min_height_m || height > cfg.max_height_m) { return 0.0; }
  if (height < WATER_LEVEL + cfg.water_clearance_m || normal_y < cfg.slope_min_y) { return 0.0; }
  let weights = tree_material_weights(height, normal_y);
  let material_density = max(0.0, dot(weights, cfg.material_density));
  let ground_weight = clamp((weights.x + weights.y * 0.25) * material_density, 0.0, 1.0);
  if (weights.y >= cfg.rock_reject || weights.w >= cfg.snow_reject) { return 0.0; }
  let material_mask = pow(
    smoothstep(cfg.min_ground_weight, min(1.0, cfg.min_ground_weight + 0.28), ground_weight),
    max(0.001, cfg.material_weight_power),
  );
  let lower_height = smoothstep(cfg.lowland_height_m - cfg.height_fade_m, cfg.lowland_height_m, height);
  let upper_height = 1.0 - smoothstep(cfg.highland_height_m, cfg.highland_height_m + cfg.height_fade_m, height);
  let slope_mask = smoothstep(cfg.slope_fade_start_y, cfg.slope_fade_end_y, normal_y);
  let clump_mask = tree_parent_clump_mask(wpos, cfg);
  let forest_cover = tree_forest_cover_mask(wpos, cfg);
  let shoreline_mask = tree_shoreline_density_mask(height, normal_y, cfg);
  let competition_mask = tree_local_competition_mask(floor(wpos / max(params.settings_a.x, 0.001)), wpos, cfg);
  return clamp(cfg.base_density * lower_height * upper_height * slope_mask * material_mask * clump_mask * forest_cover * shoreline_mask * competition_mask, 0.0, 1.0);
}

fn tree_accept_params_from_uniforms() -> TreeAcceptParams {
  return TreeAcceptParams(
    params.settings_u.z,
    params.settings_a.y,
    params.settings_a.z,
    params.settings_a.w,
    params.settings_b.x,
    params.settings_b.y,
    params.settings_b.z,
    params.settings_b.w,
    params.settings_c.x,
    params.settings_c.y,
    params.settings_c.z,
    params.settings_c.w,
    params.settings_d.x,
    params.settings_d.y,
    params.settings_d.z,
    params.settings_d.w,
    params.settings_e.x,
    params.settings_e.y,
    params.material_density,
  );
}

fn tree_species_weight(species: u32) -> f32 {
  if (species < 4u) { return max(0.0, params.species_weights_a[species]); }
  return max(0.0, params.species_weights_b[species - 4u]);
}

fn tree_instance_scale(wc: vec2<f32>, wpos: vec2<f32>, normal_y: f32, species: u32) -> f32 {
  let cfg = tree_accept_params_from_uniforms();
  let age = smoothstep(0.16, 1.0, tree_hash(wc, 601u));
  let clump = clamp(tree_parent_clump_mask(wpos, cfg), 0.0, 1.25);
  let slope_health = smoothstep(cfg.slope_fade_start_y, cfg.slope_fade_end_y, normal_y);
  let forest_cover = tree_forest_cover_mask(wpos, cfg);
  let forest_edge_stress = 1.0 - forest_cover;
  let edge_noise = tree_hash(wc, 3407u);
  let edge_scale = mix(0.78, 1.0, forest_cover) * mix(0.9, 1.05, edge_noise * forest_edge_stress);
  let base_scale = (0.58 + age * 0.48 + clump * 0.18 + slope_health * 0.08) * edge_scale;
  var species_scale = 1.0;
  if (species == 0u) { species_scale = mix(0.92, 1.18, age); }
  else if (species == 1u) { species_scale = mix(1.08, 1.34, age); }
  else if (species == 2u) { species_scale = mix(0.72, 0.96, age); }
  else if (species == 3u) { species_scale = mix(0.86, 1.08, age); }
  else if (species == 4u) { species_scale = mix(0.82, 1.12, age); }
  else { species_scale = mix(1.12, 1.42, age); }
  return clamp(base_scale * species_scale, 0.42, 1.62);
}

fn tree_lod_ring(distance_m: f32, params: TreeLodParams) -> TreeLodRing {
  let dist = max(0.0, distance_m);
  let near_m = max(0.0, params.near_m);
  let mid_m = max(near_m, params.mid_m);
  let far_m = max(mid_m, params.far_m);
  let radius_m = max(far_m, params.radius_m);
  let band_m = max(0.0, params.band_m);
  var lod_active = vec4<u32>(0u);
  var fade = vec4<f32>(0.0);
  if (band_m <= 0.0) {
    if (dist <= near_m) { lod_active.x = 1u; fade.x = 1.0; }
    else if (dist <= mid_m) { lod_active.y = 1u; fade.y = 1.0; }
    else if (dist <= far_m) { lod_active.z = 1u; fade.z = 1.0; }
    else if (dist <= radius_m) { lod_active.w = 1u; fade.w = 1.0; }
    return TreeLodRing(lod_active, fade);
  }
  if (dist < near_m + band_m) { lod_active.x = 1u; fade.x = 1.0; }
  if (dist >= near_m - band_m && dist < mid_m + band_m) { lod_active.y = 1u; fade.y = 1.0; }
  if (dist >= mid_m - band_m && dist < far_m + band_m) { lod_active.z = 1u; fade.z = 1.0; }
  if (dist >= far_m - band_m && dist <= radius_m + band_m) { lod_active.w = 1u; fade.w = 1.0; }
  if (dist >= near_m - band_m && dist <= near_m + band_m) {
    let t = clamp((dist - (near_m - band_m)) / (band_m * 2.0), 0.0, 1.0);
    fade.x = min(fade.x, 1.0 - t);
    fade.y = min(fade.y, t);
  }
  if (dist >= mid_m - band_m && dist <= mid_m + band_m) {
    let t = clamp((dist - (mid_m - band_m)) / (band_m * 2.0), 0.0, 1.0);
    fade.y = min(fade.y, 1.0 - t);
    fade.z = min(fade.z, t);
  }
  if (dist >= far_m - band_m && dist <= far_m + band_m) {
    let t = clamp((dist - (far_m - band_m)) / (band_m * 2.0), 0.0, 1.0);
    fade.z = min(fade.z, 1.0 - t);
    fade.w = min(fade.w, t);
  }
  fade = fade * vec4<f32>(lod_active);
  return TreeLodRing(lod_active, fade);
}

fn group_index(species: u32, lod: u32) -> u32 { return species * TREE_LOD_COUNT + lod; }
fn shadow_group_index(cascade: u32, species: u32, lod: u32) -> u32 { return cascade * TREE_GROUP_COUNT + group_index(species, lod); }

fn index_count_for_group(group: u32) -> u32 {
  if (group < 4u) { return params.index_counts_a[group]; }
  if (group < 8u) { return params.index_counts_b[group - 4u]; }
  if (group < 12u) { return params.index_counts_c[group - 8u]; }
  if (group < 16u) { return params.index_counts_d[group - 12u]; }
  if (group < 20u) { return params.index_counts_e[group - 16u]; }
  return params.index_counts_f[group - 20u];
}

fn in_frustum(center: vec3<f32>, slack: f32) -> bool {
  for (var p = 0u; p < 6u; p = p + 1u) {
    let plane = params.planes[p];
    if (dot(plane.xyz, center) + plane.w < -slack) { return false; }
  }
  return true;
}

fn in_shadow_cascade_frustum(cascade: u32, center: vec3<f32>, slack: f32) -> bool {
  let base = cascade * TREE_SHADOW_PLANE_COUNT;
  for (var p = 0u; p < TREE_SHADOW_PLANE_COUNT; p = p + 1u) {
    let plane = params.shadow_planes[base + p];
    if (dot(plane.xyz, center) + plane.w < -slack) { return false; }
  }
  return true;
}

fn tree_terrain_visibility_enabled() -> bool {
  return params.terrain_visibility.x > 0.5;
}

fn tree_terrain_debug_counts_enabled() -> bool {
  return params.terrain_visibility_u.y != 0u;
}

fn record_tree_terrain_visibility(terrain_hidden: bool) {
  if (!tree_terrain_debug_counts_enabled()) { return; }
  if (terrain_hidden) {
    atomicAdd(&shadow_counters[TREE_TERRAIN_HIDDEN_COUNTER], 1u);
    return;
  }
  atomicAdd(&shadow_counters[TREE_TERRAIN_VISIBLE_COUNTER], 1u);
}

fn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {
  if (distance_m <= params.terrain_visibility.y) { return false; }
  let start_xz = params.center_radius.xy;
  let start_height = params.settings_e.w;
  let crown_height = end_height + max(0.0, params.terrain_visibility.w);
  let sample_count = max(1u, min(16u, params.terrain_visibility_u.x));
  for (var i = 1u; i <= sample_count; i = i + 1u) {
    let t = f32(i) / f32(sample_count + 1u);
    let sample_xz = mix(start_xz, end_xz, t);
    let sample_line_height = mix(start_height, crown_height, t);
    let sample_ground_height = surfaceHeightField(sample_xz.x, sample_xz.y);
    if (sample_ground_height > sample_line_height + max(0.0, params.terrain_visibility.z)) { return true; }
  }
  return false;
}

fn species_material_bias(species: u32, materials: vec4<f32>) -> f32 {
  if (species == 0u) { return max(0.0, dot(materials, params.species_material_oak)); }
  if (species == 1u) { return max(0.0, dot(materials, params.species_material_pine)); }
  if (species == 2u) { return max(0.0, dot(materials, params.species_material_dead)); }
  if (species == 3u) { return max(0.0, dot(materials, params.species_material_birch)); }
  if (species == 4u) { return max(0.0, dot(materials, params.species_material_willow)); }
  return max(0.0, dot(materials, params.species_material_spruce));
}

fn select_species(wc: vec2<f32>, wpos: vec2<f32>, height: f32, normal_y: f32) -> u32 {
  var base = array<f32, 6>(
    tree_species_weight(0u),
    tree_species_weight(1u),
    tree_species_weight(2u),
    tree_species_weight(3u),
    tree_species_weight(4u),
    tree_species_weight(5u),
  );
  let cfg = tree_accept_params_from_uniforms();
  let materials = tree_material_weights(height, normal_y);
  let height_band = smoothstep(cfg.lowland_height_m, cfg.highland_height_m, height);
  let moisture = 1.0 - clamp((height - WATER_LEVEL) / 42.0, 0.0, 1.0);
  let slope_health = smoothstep(cfg.slope_fade_start_y, cfg.slope_fade_end_y, normal_y);
  let ridge_stress = 1.0 - slope_health;
  let clump = clamp(tree_parent_clump_mask(wpos, cfg), 0.0, 1.25);
  let old_age = smoothstep(0.58, 0.96, tree_hash(wc, 2309u));
  base[0] = base[0] * species_material_bias(0u, materials) * mix(1.45, 0.52, height_band) * mix(0.78, 1.28, moisture) * mix(0.82, 1.18, slope_health) * (1.0 - materials.y * 0.35) * mix(1.06, 0.82, old_age);
  base[1] = base[1] * species_material_bias(1u, materials) * mix(0.52, 1.62, height_band) * mix(0.84, 1.16, 1.0 - moisture) * mix(0.78, 1.25, slope_health) * (1.0 + materials.y * 0.22) * mix(1.02, 0.9, old_age);
  base[2] = base[2] * species_material_bias(2u, materials) * (0.38 + clump * 0.28 + ridge_stress * 0.42 + materials.y * 0.32 + old_age * 0.72);
  base[3] = base[3] * species_material_bias(3u, materials) * mix(1.28, 0.68, height_band) * mix(0.88, 1.12, moisture) * mix(0.92, 1.12, slope_health) * mix(1.0, 1.08, clump);
  base[4] = base[4] * species_material_bias(4u, materials) * mix(1.48, 0.38, height_band) * mix(0.72, 1.45, moisture) * mix(1.18, 0.72, ridge_stress) * (1.0 + materials.z * 0.26);
  base[5] = base[5] * species_material_bias(5u, materials) * mix(0.42, 1.78, height_band) * mix(0.82, 1.18, 1.0 - moisture) * mix(0.74, 1.32, slope_health) * (1.0 + materials.y * 0.28 + materials.w * 0.18);
  var total = 0.0;
  for (var i = 0u; i < TREE_SPECIES_COUNT; i = i + 1u) {
    base[i] = max(0.0, base[i]);
    total = total + base[i];
  }
  if (total <= 0.0) { return 0xffffffffu; }
  let roll = tree_hash(wc, 409u) * total;
  var cursor = 0.0;
  for (var i = 0u; i < TREE_SPECIES_COUNT; i = i + 1u) {
    cursor = cursor + base[i];
    if (roll < cursor) { return i; }
  }
  return TREE_SPECIES_COUNT - 1u;
}

fn append_tree(species: u32, lod: u32, wc: vec2<f32>, height: f32, scale: f32) {
  let max_per_group = params.settings_u.x;
  let group = group_index(species, lod);
  let slot = atomicAdd(&counters[group], 1u);
  if (slot >= max_per_group) { return; }
  let out_index = group * max_per_group + slot;
  out_cell[out_index] = vec4<f32>(wc.x, wc.y, height, scale);
}

fn append_shadow_tree(cascade: u32, species: u32, lod: u32, wc: vec2<f32>, height: f32, scale: f32) {
  let max_per_group = params.settings_u.w;
  if (max_per_group == 0u) { return; }
  let group = shadow_group_index(cascade, species, lod);
  let slot = atomicAdd(&shadow_counters[group], 1u);
  if (slot >= max_per_group) { return; }
  let out_index = group * max_per_group + slot;
  out_shadow_cell[out_index] = vec4<f32>(wc.x, wc.y, height, scale);
}

fn append_lod_if_active(species: u32, lod: u32, lod_active: u32, wc: vec2<f32>, height: f32, scale: f32) {
  if (lod_active != 0u) { append_tree(species, lod, wc, height, scale); }
}

fn append_shadow_lod_if_active(species: u32, lod: u32, lod_active: u32, center: vec3<f32>, wc: vec2<f32>, height: f32, scale: f32) {
  if (lod_active == 0u || params.settings_u.w == 0u) { return; }
  for (var cascade = 0u; cascade < TREE_SHADOW_CASCADE_COUNT; cascade = cascade + 1u) {
    if (in_shadow_cascade_frustum(cascade, center, 12.0)) {
      append_shadow_tree(cascade, species, lod, wc, height, scale);
    }
  }
}

fn process_tree_slot(slot: u32) {
  let grid = params.settings_u.y;
  let max_per_group = params.settings_u.x;
  if (slot >= grid * grid || max_per_group == 0u) { return; }
  let cell_size = params.settings_a.x;
  let wc = tree_world_cell_from_slot(slot, grid, cell_size, params.center_radius.xy);
  let jitter = tree_hash2(wc, 1103u);
  let wpos = (wc + jitter) * cell_size;
  // See grass_ring.compute.wgsl: the [0, world_max] box only bounds a finite world. Island worlds
  // have real terrain far outside the startup square (the ring is a player-centered window), so skip
  // the box reject there and let the tree masks decide; otherwise trees form a fixed disc at the
  // startup world edge the player walks out of.
  let world_max = params.center_radius.w;
  if (fieldParams.islandEnabled == 0u && (wpos.x <= 0.0 || wpos.y <= 0.0 || wpos.x >= world_max || wpos.y >= world_max)) { return; }
  let dist = distance(wpos, params.center_radius.xy);
  if (dist > params.center_radius.z + params.lod.w) { return; }

  let cfg = tree_accept_params_from_uniforms();
  let raw_height = surfaceHeightField(wpos.x, wpos.y);
  let hydro = tree_hydrology_at(wpos.x, wpos.y);
  let height = tree_hydrology_ground_height(raw_height, hydro);
  if (tree_hydrology_reject_tree(hydro, height, cfg)) { return; }
  let normal_y = tree_height_normal_y(wpos);
  let accept = tree_accept_mask(height, normal_y, wpos, cfg)
    * tree_hydrology_bank_density_mask(hydro, height, normal_y, cfg);
  if (tree_hash(wc, 809u) >= accept) { return; }
  let species = select_species(wc, wpos, height, normal_y);
  if (species >= TREE_SPECIES_COUNT) { return; }
  let scale = tree_instance_scale(wc, wpos, normal_y, species) * tree_hydrology_scale_mask(hydro, height);
  let ring = tree_lod_ring(dist, TreeLodParams(params.lod.x, params.lod.y, params.lod.z, params.center_radius.z, params.lod.w));
  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
  var terrain_hidden = false;
  if (tree_terrain_visibility_enabled()) {
    terrain_hidden = terrain_ridge_filter(wpos, height, dist);
    record_tree_terrain_visibility(terrain_hidden);
  }
  if (terrain_hidden) { return; }
  append_shadow_lod_if_active(species, TREE_LOD_NEAR, ring.lod_active.x, shadow_center, wc, height, scale);
  append_shadow_lod_if_active(species, TREE_LOD_MID, ring.lod_active.y, shadow_center, wc, height, scale);
  append_shadow_lod_if_active(species, TREE_LOD_FAR, ring.lod_active.z, shadow_center, wc, height, scale);
  append_shadow_lod_if_active(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, shadow_center, wc, height, scale);
  if (!in_frustum(shadow_center, 8.0)) { return; }
  append_lod_if_active(species, TREE_LOD_NEAR, ring.lod_active.x, wc, height, scale);
  append_lod_if_active(species, TREE_LOD_MID, ring.lod_active.y, wc, height, scale);
  append_lod_if_active(species, TREE_LOD_FAR, ring.lod_active.z, wc, height, scale);
  append_lod_if_active(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, wc, height, scale);
}

@compute @workgroup_size(TREE_WORKGROUP_SIZE)
fn clear_counters(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < TREE_GROUP_COUNT) { atomicStore(&counters[i], 0u); }
  if (i < TREE_GROUP_COUNT * TREE_INDIRECT_STRIDE_U32) { indirect_args[i] = 0u; }
  if (i < TREE_SHADOW_GROUP_COUNT) { atomicStore(&shadow_counters[i], 0u); }
  if (i < 2u) { atomicStore(&shadow_counters[TREE_SHADOW_GROUP_COUNT + i], 0u); }
  if (i < TREE_SHADOW_GROUP_COUNT * TREE_INDIRECT_STRIDE_U32) { shadow_indirect_args[i] = 0u; }
}

@compute @workgroup_size(TREE_WORKGROUP_SIZE)
fn tree_cull(@builtin(global_invocation_id) id: vec3<u32>) {
  process_tree_slot(id.x);
}

fn write_draw_args(group: u32, index_count: u32, instance_count: u32) {
  let base = group * TREE_INDIRECT_STRIDE_U32;
  indirect_args[base + 0u] = index_count;
  indirect_args[base + 1u] = min(instance_count, params.settings_u.x);
  indirect_args[base + 2u] = 0u;
  indirect_args[base + 3u] = 0u;
  indirect_args[base + 4u] = group * params.settings_u.x;
}

fn write_shadow_draw_args(group: u32, instance_count: u32) {
  let max_per_group = params.settings_u.w;
  let base = group * TREE_INDIRECT_STRIDE_U32;
  shadow_indirect_args[base + 0u] = index_count_for_group(group % TREE_GROUP_COUNT);
  shadow_indirect_args[base + 1u] = min(instance_count, max_per_group);
  shadow_indirect_args[base + 2u] = 0u;
  shadow_indirect_args[base + 3u] = 0u;
  shadow_indirect_args[base + 4u] = group * max_per_group;
}

@compute @workgroup_size(TREE_WORKGROUP_SIZE)
fn build_indirect_args(@builtin(global_invocation_id) id: vec3<u32>) {
  let group = id.x;
  if (group < TREE_GROUP_COUNT) {
    write_draw_args(group, index_count_for_group(group), atomicLoad(&counters[group]));
  }
  if (group < TREE_SHADOW_GROUP_COUNT) {
    write_shadow_draw_args(group, atomicLoad(&shadow_counters[group]));
  }
}
