const TREE_WORKGROUP_SIZE: u32 = 64u;
const TREE_LOD_NEAR: u32 = 0u;
const TREE_LOD_MID: u32 = 1u;
const TREE_LOD_FAR: u32 = 2u;
const TREE_LOD_IMPOSTOR: u32 = 3u;
const TREE_LOD_COUNT: u32 = 4u;
const TREE_SPECIES_COUNT: u32 = 3u;
const TREE_GROUP_COUNT: u32 = TREE_SPECIES_COUNT * TREE_LOD_COUNT;
const TREE_INDIRECT_STRIDE_U32: u32 = 5u;
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
  active: vec4<u32>,
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
  species_weights: vec4<f32>,
  index_counts_a: vec4<u32>,
  index_counts_b: vec4<u32>,
  index_counts_c: vec4<u32>,
  settings_u: vec4<u32>,
  material_density: vec4<f32>,
  species_material_oak: vec4<f32>,
  species_material_pine: vec4<f32>,
  species_material_dead: vec4<f32>,
  planes: array<vec4<f32>, 6>,
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
@group(0) @binding(9) var hydro_texture: texture_2d<f32>;
@group(0) @binding(10) var hydro_sampler: sampler;

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

fn tree_terrain_roughness_mask(height: f32, wpos: vec2<f32>) -> f32 {
  let sample_radius = max(params.settings_a.x * 1.5, 4.0);
  let hx0 = surfaceHeightField(wpos.x - sample_radius, wpos.y);
  let hx1 = surfaceHeightField(wpos.x + sample_radius, wpos.y);
  let hz0 = surfaceHeightField(wpos.x, wpos.y - sample_radius);
  let hz1 = surfaceHeightField(wpos.x, wpos.y + sample_radius);
  let roughness = (abs(hx0 - height) + abs(hx1 - height) + abs(hz0 - height) + abs(hz1 - height)) * 0.25;
  let rough_mask = 1.0 - smoothstep(2.6, 8.5, roughness) * 0.48;
  let terrace_bonus = smoothstep(0.0, 2.4, 2.4 - roughness) * 0.06;
  return clamp(rough_mask + terrace_bonus, 0.52, 1.06);
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
  let roughness_mask = tree_terrain_roughness_mask(height, wpos);
  return clamp(cfg.base_density * lower_height * upper_height * slope_mask * material_mask * clump_mask * forest_cover * shoreline_mask * competition_mask * roughness_mask, 0.0, 1.0);
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
  else { species_scale = mix(0.72, 0.96, age); }
  return clamp(base_scale * species_scale, 0.42, 1.62);
}

fn tree_lod_ring(distance_m: f32, params: TreeLodParams) -> TreeLodRing {
  let dist = max(0.0, distance_m);
  let near_m = max(0.0, params.near_m);
  let mid_m = max(near_m, params.mid_m);
  let far_m = max(mid_m, params.far_m);
  let radius_m = max(far_m, params.radius_m);
  let band_m = max(0.0, params.band_m);
  var active = vec4<u32>(0u);
  var fade = vec4<f32>(0.0);
  if (band_m <= 0.0) {
    if (dist <= near_m) { active.x = 1u; fade.x = 1.0; }
    else if (dist <= mid_m) { active.y = 1u; fade.y = 1.0; }
    else if (dist <= far_m) { active.z = 1u; fade.z = 1.0; }
    else if (dist <= radius_m) { active.w = 1u; fade.w = 1.0; }
    return TreeLodRing(active, fade);
  }
  if (dist < near_m + band_m) { active.x = 1u; fade.x = 1.0; }
  if (dist >= near_m - band_m && dist < mid_m + band_m) { active.y = 1u; fade.y = 1.0; }
  if (dist >= mid_m - band_m && dist < far_m + band_m) { active.z = 1u; fade.z = 1.0; }
  if (dist >= far_m - band_m && dist <= radius_m + band_m) { active.w = 1u; fade.w = 1.0; }
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
  fade = fade * vec4<f32>(active);
  return TreeLodRing(active, fade);
}

fn group_index(species: u32, lod: u32) -> u32 { return species * TREE_LOD_COUNT + lod; }

fn index_count_for_group(group: u32) -> u32 {
  if (group < 4u) { return params.index_counts_a[group]; }
  if (group < 8u) { return params.index_counts_b[group - 4u]; }
  return params.index_counts_c[group - 8u];
}

fn in_frustum(center: vec3<f32>, slack: f32) -> bool {
  for (var p = 0u; p < 6u; p = p + 1u) {
    let plane = params.planes[p];
    if (dot(plane.xyz, center) + plane.w < -slack) { return false; }
  }
  return true;
}

fn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {
  if (distance_m <= params.lod.y) { return false; }
  let start_xz = params.center_radius.xy;
  let start_height = surfaceHeightField(start_xz.x, start_xz.y) + 18.0;
  let crown_height = end_height + 5.5;
  for (var i = 1u; i <= 6u; i = i + 1u) {
    let t = f32(i) / 7.0;
    let sample_xz = mix(start_xz, end_xz, t);
    let sample_line_height = mix(start_height, crown_height, t);
    let sample_ground_height = surfaceHeightField(sample_xz.x, sample_xz.y);
    if (sample_ground_height > sample_line_height + 1.75) { return true; }
  }
  return false;
}

fn species_material_bias(species: u32, materials: vec4<f32>) -> f32 {
  if (species == 0u) { return max(0.0, dot(materials, params.species_material_oak)); }
  if (species == 1u) { return max(0.0, dot(materials, params.species_material_pine)); }
  return max(0.0, dot(materials, params.species_material_dead));
}

fn select_species(wc: vec2<f32>, wpos: vec2<f32>, height: f32, normal_y: f32) -> u32 {
  let base = max(params.species_weights.xyz, vec3<f32>(0.0));
  if (base.x + base.y + base.z <= 0.0) { return 0xffffffffu; }
  let cfg = tree_accept_params_from_uniforms();
  let materials = tree_material_weights(height, normal_y);
  let height_band = smoothstep(cfg.lowland_height_m, cfg.highland_height_m, height);
  let moisture = 1.0 - clamp((height - WATER_LEVEL) / 42.0, 0.0, 1.0);
  let slope_health = smoothstep(cfg.slope_fade_start_y, cfg.slope_fade_end_y, normal_y);
  let ridge_stress = 1.0 - slope_health;
  let clump = clamp(tree_parent_clump_mask(wpos, cfg), 0.0, 1.25);
  let old_age = smoothstep(0.58, 0.96, tree_hash(wc, 2309u));
  let oak = base.x
    * species_material_bias(0u, materials)
    * mix(1.45, 0.52, height_band)
    * mix(0.78, 1.28, moisture)
    * mix(0.82, 1.18, slope_health)
    * (1.0 - materials.y * 0.35)
    * mix(1.06, 0.82, old_age);
  let pine = base.y
    * species_material_bias(1u, materials)
    * mix(0.52, 1.62, height_band)
    * mix(0.84, 1.16, 1.0 - moisture)
    * mix(0.78, 1.25, slope_health)
    * (1.0 + materials.y * 0.22)
    * mix(1.02, 0.9, old_age);
  let dead = base.z
    * species_material_bias(2u, materials)
    * (0.38 + clump * 0.28 + ridge_stress * 0.42 + materials.y * 0.32 + old_age * 0.72);
  let weights = max(vec3<f32>(oak, pine, dead), vec3<f32>(0.0));
  let total = weights.x + weights.y + weights.z;
  if (total <= 0.0) { return 0xffffffffu; }
  let roll = tree_hash(wc, 409u) * total;
  if (roll < weights.x) { return 0u; }
  if (roll < weights.x + weights.y) { return 1u; }
  return 2u;
}

fn append_tree(species: u32, lod: u32, wc: vec2<f32>, height: f32, scale: f32) {
  let max_per_group = params.settings_u.x;
  let group = group_index(species, lod);
  let slot = atomicAdd(&counters[group], 1u);
  if (slot >= max_per_group) { return; }
  let out_index = group * max_per_group + slot;
  out_cell[out_index] = vec4<f32>(wc.x, wc.y, height, scale);
}

fn append_lod_if_active(species: u32, lod: u32, active: u32, wc: vec2<f32>, height: f32, scale: f32) {
  if (active != 0u) { append_tree(species, lod, wc, height, scale); }
}

fn process_tree_slot(slot: u32) {
  let grid = params.settings_u.y;
  let max_per_group = params.settings_u.x;
  if (slot >= grid * grid || max_per_group == 0u) { return; }
  let cell_size = params.settings_a.x;
  let wc = tree_world_cell_from_slot(slot, grid, cell_size, params.center_radius.xy);
  let jitter = tree_hash2(wc, 1103u);
  let wpos = (wc + jitter) * cell_size;
  let world_max = params.center_radius.w;
  if (wpos.x <= 0.0 || wpos.y <= 0.0 || wpos.x >= world_max || wpos.y >= world_max) { return; }
  let dist = distance(wpos, params.center_radius.xy);
  if (dist > params.center_radius.z + params.lod.w) { return; }

  let cfg = tree_accept_params_from_uniforms();
  let raw_height = surfaceHeightField(wpos.x, wpos.y);
  let hydro = tree_hydrology_at(wpos.x, wpos.y);
  let height = tree_hydrology_ground_height(raw_height, hydro);
  if (tree_hydrology_reject_tree(hydro, height, cfg)) { return; }
  let normal = normalize(densityGradient(wpos.x, height, wpos.y));
  let accept = tree_accept_mask(height, normal.y, wpos, cfg)
    * tree_hydrology_bank_density_mask(hydro, height, normal.y, cfg);
  if (tree_hash(wc, 809u) >= accept) { return; }
  if (!in_frustum(vec3<f32>(wpos.x, height + 4.0, wpos.y), 8.0)) { return; }
  if (terrain_ridge_filter(wpos, height, dist)) { return; }
  let species = select_species(wc, wpos, height, normal.y);
  if (species >= TREE_SPECIES_COUNT) { return; }
  let scale = tree_instance_scale(wc, wpos, normal.y, species) * tree_hydrology_scale_mask(hydro, height);
  let ring = tree_lod_ring(dist, TreeLodParams(params.lod.x, params.lod.y, params.lod.z, params.center_radius.z, params.lod.w));
  append_lod_if_active(species, TREE_LOD_NEAR, ring.active.x, wc, height, scale);
  append_lod_if_active(species, TREE_LOD_MID, ring.active.y, wc, height, scale);
  append_lod_if_active(species, TREE_LOD_FAR, ring.active.z, wc, height, scale);
  append_lod_if_active(species, TREE_LOD_IMPOSTOR, ring.active.w, wc, height, scale);
}

@compute @workgroup_size(TREE_WORKGROUP_SIZE)
fn clear_counters(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < TREE_GROUP_COUNT) { atomicStore(&counters[i], 0u); }
  if (i < TREE_GROUP_COUNT * TREE_INDIRECT_STRIDE_U32) { indirect_args[i] = 0u; }
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

@compute @workgroup_size(TREE_WORKGROUP_SIZE)
fn build_indirect_args(@builtin(global_invocation_id) id: vec3<u32>) {
  let group = id.x;
  if (group >= TREE_GROUP_COUNT) { return; }
  write_draw_args(group, index_count_for_group(group), atomicLoad(&counters[group]));
}
