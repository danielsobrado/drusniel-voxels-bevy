const WORKGROUP_SIZE: u32 = 64u;
const TIER_NEAR: u32 = 0u;
const TIER_MID: u32 = 1u;
const TIER_FAR: u32 = 2u;
const TIER_SUPER: u32 = 3u;
const INDIRECT_STRIDE_U32: u32 = 5u;
const TAU: f32 = 6.28318530718;
const GRASS_WATER_CLEARANCE: f32 = 0.18;
const GRASS_HYDRO_WATER_CLEARANCE: f32 = 0.35;
const GRASS_LOW_BANK_START_M: f32 = 0.8;
const GRASS_LOW_BANK_END_M: f32 = 4.2;
const GRASS_MOIST_BANK_START_M: f32 = 3.2;
const GRASS_MOIST_BANK_END_M: f32 = 11.0;
const GRASS_MID_HEIGHT_MUL: f32 = 1.18;
const GRASS_FAR_HEIGHT_MUL: f32 = 1.30;
const GRASS_SUPER_HEIGHT_MUL: f32 = 1.42;
const GRASS_FAR_WIDTH_MUL_MAX: f32 = 1.55;
const GRASS_SUPER_WIDTH_EXTRA: f32 = 1.08;

struct Params {
  center_radius: vec4<f32>,
  bands: vec4<f32>,
  settings_a: vec4<f32>,
  settings_b: vec4<f32>,
  counts_a: vec4<u32>,
  counts_b: vec4<u32>,
  density_a: vec4<f32>,
  density_b: vec4<f32>,
  material_density: vec4<f32>,
  height_density_a: vec4<f32>,
  height_density_b: vec4<f32>,
  planes: array<vec4<f32>, 6>,
};

struct HydrologySample {
  water_y: f32,
  wet_mask: f32,
  carved_bed: f32,
  enabled: f32,
};

struct GrassRiverBand {
  channel_clear: f32,
  low_bank: f32,
  moist_bank: f32,
  density: f32,
  height: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indirect_args: array<u32>;
@group(0) @binding(3) var<storage, read_write> out_offset: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> out_packed0: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> out_packed1: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> out_normal: array<vec4<f32>>;
@group(0) @binding(9) var hydro_texture: texture_2d<f32>;
@group(0) @binding(10) var hydro_sampler: sampler;

fn pcg2d(cell: vec2<f32>, salt: u32) -> vec2<f32> {
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

fn world_cell(slot: u32) -> vec2<f32> {
  let grid = params.counts_b.y;
  let cell = params.settings_a.x;
  let sx = f32(slot % grid);
  let sy = f32(slot / grid);
  let cam_cell = params.center_radius.xy / cell;
  return vec2<f32>(
    round((cam_cell.x - sx) / f32(grid)) * f32(grid) + sx,
    round((cam_cell.y - sy) / f32(grid)) * f32(grid) + sy,
  );
}

fn hydrology_at(wx: f32, wz: f32) -> HydrologySample {
  if (!placement_hydro_enabled()) {
    return HydrologySample(0.0, 0.0, 0.0, 0.0);
  }
  let world_size = max(1.0, params.center_radius.w);
  let h = placement_sample_hydro_bilinear(wx, wz, world_size);
  return HydrologySample(h.x, h.y, h.z, 1.0);
}

fn hydrology_reject_grass(sample: HydrologySample, ground_height: f32) -> bool {
  if (sample.enabled < 0.5) { return false; }
  if (sample.wet_mask <= 0.05) { return false; }
  return ground_height <= sample.water_y + GRASS_HYDRO_WATER_CLEARANCE;
}

fn material_weights(height: f32, normal_y: f32) -> vec4<f32> {
  _ = normal_y;
  let sand = max(0.0, 1.0 - abs(height - WATER_LEVEL) / 6.0);
  let snow = max(0.0, (height - 88.0) / 22.0);
  let rock = clamp((height - 48.0) / 34.0, 0.0, 1.0) * (1.0 - snow);
  let grass = max(0.0, 1.0 - sand - snow - rock);
  let sum = max(1e-5, grass + rock + sand + snow);
  return vec4<f32>(grass, rock, sand, snow) / sum;
}

fn paintMaterialAt(wx: f32, wz: f32, height: f32) -> i32 {
  let fade = 3.0;
  let count = arrayLength(&digEdits);
  for (var i = 0u; i < count; i = i + 1u) {
    let e = digEdits[i];
    if (e.opAdd == 0) { continue; }
    let dx = wx - e.x;
    let dy = height - e.y;
    let dz = wz - e.z;
    let d = sqrt(dx * dx + dy * dy + dz * dz);
    if (d < e.r + fade) { return e.material; }
  }
  return -1;
}

fn material_weights_with_paint(height: f32, normal_y: f32, wx: f32, wz: f32) -> vec4<f32> {
  let base = material_weights(height, normal_y);
  let slot = paintMaterialAt(wx, wz, height);
  if (slot < 0) { return base; }
  if (slot == 1) { return vec4<f32>(0.0, 1.0, 0.0, 0.0); }
  if (slot == 2) { return vec4<f32>(0.0, 0.0, 1.0, 0.0); }
  if (slot == 3) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  return base;
}

fn grass_height_density(height: f32) -> f32 {
  let blend = max(0.001, params.height_density_a.z);
  let low = 1.0 - smoothstep(params.height_density_a.x - blend, params.height_density_a.x + blend, height);
  let high = smoothstep(params.height_density_a.y - blend, params.height_density_a.y + blend, height);
  let mid = max(0.0, 1.0 - low - high);
  let sum = max(0.00001, low + mid + high);
  return (params.height_density_a.w * low + params.height_density_b.x * mid + params.height_density_b.y * high) / sum;
}

fn grass_terrain_density(weights: vec4<f32>, height: f32) -> f32 {
  return max(0.0, dot(weights, params.material_density)) * grass_height_density(height);
}

fn wet_bank(height: f32, normal_y: f32) -> f32 {
  let bank_height = (1.0 - smoothstep(WATER_LEVEL + 1.0, WATER_LEVEL + 8.0, height))
    * smoothstep(WATER_LEVEL + GRASS_WATER_CLEARANCE, WATER_LEVEL + 2.5, height);
  return bank_height * smoothstep(0.42, 0.82, normal_y);
}

fn segment_distance(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let ab = b - a;
  let denom = max(dot(ab, ab), 1e-6);
  let t = clamp(dot(p - a, ab) / denom, 0.0, 1.0);
  return distance(p, a + ab * t);
}

fn fallback_river_distance_m(wx: f32, wz: f32) -> f32 {
  let world_size = max(1.0, params.center_radius.w);
  let p = vec2<f32>(wx / world_size, wz / world_size);
  var d = 1e6;
  d = min(d, segment_distance(p, vec2<f32>(0.08, 0.32), vec2<f32>(0.24, 0.39)));
  d = min(d, segment_distance(p, vec2<f32>(0.24, 0.39), vec2<f32>(0.42, 0.47)));
  d = min(d, segment_distance(p, vec2<f32>(0.42, 0.47), vec2<f32>(0.61, 0.56)));
  d = min(d, segment_distance(p, vec2<f32>(0.61, 0.56), vec2<f32>(0.86, 0.68)));
  d = min(d, segment_distance(p, vec2<f32>(0.72, 0.12), vec2<f32>(0.66, 0.27)));
  d = min(d, segment_distance(p, vec2<f32>(0.66, 0.27), vec2<f32>(0.58, 0.42)));
  d = min(d, segment_distance(p, vec2<f32>(0.58, 0.42), vec2<f32>(0.48, 0.51)));
  return d * world_size;
}

fn fallback_river_grass_band(wx: f32, wz: f32) -> GrassRiverBand {
  let dist = fallback_river_distance_m(wx, wz);
  let channel_clear = 1.0 - smoothstep(7.0, 12.0, dist);
  let low_bank = smoothstep(8.0, 13.0, dist) * (1.0 - smoothstep(13.0, 20.0, dist));
  let moist_bank = smoothstep(16.0, 24.0, dist) * (1.0 - smoothstep(24.0, 42.0, dist));
  let density = clamp((1.0 - channel_clear) * mix(0.68, 1.12, moist_bank) * mix(1.0, 0.62, low_bank), 0.0, 1.12);
  let height = clamp(mix(1.0, 0.56, low_bank) * mix(1.0, 1.08, moist_bank), 0.48, 1.10);
  return GrassRiverBand(channel_clear, low_bank, moist_bank, density, height);
}

fn hydro_river_grass_band(sample: HydrologySample, ground_height: f32) -> GrassRiverBand {
  if (sample.enabled < 0.5 || sample.wet_mask <= 0.001) {
    return GrassRiverBand(0.0, 0.0, 0.0, 1.0, 1.0);
  }
  let above_water = ground_height - sample.water_y;
  let channel_clear = 1.0 - smoothstep(GRASS_HYDRO_WATER_CLEARANCE, GRASS_LOW_BANK_START_M, above_water);
  let low_bank = smoothstep(GRASS_LOW_BANK_START_M, 1.8, above_water) * (1.0 - smoothstep(2.9, GRASS_LOW_BANK_END_M, above_water));
  let moist_bank = smoothstep(GRASS_MOIST_BANK_START_M, 5.6, above_water) * (1.0 - smoothstep(7.8, GRASS_MOIST_BANK_END_M, above_water));
  let density = clamp((1.0 - channel_clear) * mix(0.62, 1.16, moist_bank) * mix(1.0, 0.58, low_bank), 0.0, 1.16);
  let height = clamp(mix(1.0, 0.52, low_bank) * mix(1.0, 1.08, moist_bank), 0.46, 1.10);
  return GrassRiverBand(channel_clear, low_bank, moist_bank, density, height);
}

fn river_grass_ecology_band(wx: f32, wz: f32, hydro: HydrologySample, height: f32) -> GrassRiverBand {
  let fallback = fallback_river_grass_band(wx, wz);
  let hydro_band = hydro_river_grass_band(hydro, height);
  return GrassRiverBand(
    max(fallback.channel_clear, hydro_band.channel_clear),
    max(fallback.low_bank, hydro_band.low_bank),
    max(fallback.moist_bank, hydro_band.moist_bank),
    min(fallback.density, hydro_band.density) * max(1.0, max(fallback.moist_bank, hydro_band.moist_bank) * 1.08),
    min(fallback.height, hydro_band.height) * max(1.0, max(fallback.moist_bank, hydro_band.moist_bank) * 1.04),
  );
}

fn grass_mask(height: f32, normal_y: f32, distance: f32, wx: f32, wz: f32, hydro: HydrologySample) -> f32 {
  if (height < params.settings_b.x || height > params.settings_b.y) { return 0.0; }
  let weights = material_weights_with_paint(height, normal_y, wx, wz);
  let grass_weight = weights.x;
  let rock_weight = weights.y;
  let snow_weight = weights.w;
  if (height < WATER_LEVEL + GRASS_WATER_CLEARANCE || rock_weight >= 0.82 || snow_weight >= 0.55) { return 0.0; }
  let above_water = smoothstep(WATER_LEVEL + GRASS_WATER_CLEARANCE, WATER_LEVEL + 3.5, height);
  let slope_min = params.settings_a.w;
  let slope_mask = smoothstep(max(0.0, slope_min - 0.04), min(1.0, slope_min + 0.16), normal_y);
  let rock_reject = smoothstep(0.48, 0.84, rock_weight);
  let snow_reject = smoothstep(0.08, 0.55, snow_weight);
  let viable = above_water * slope_mask * (1.0 - rock_reject) * (1.0 - snow_reject);
  let bank = wet_bank(height, normal_y);
  let river_band = river_grass_ecology_band(wx, wz, hydro, height);
  let scruff_meters = params.settings_b.z;
  let scruff_min = params.density_b.y;
  let scruff = (1.0 - smoothstep(scruff_meters * 0.45, scruff_meters, distance)) * viable * scruff_min;
  let terrain_density = grass_terrain_density(weights, height);
  return clamp(max(grass_weight * viable * (1.0 - bank * 0.58), scruff) * river_band.density * terrain_density, 0.0, 1.0);
}

fn grass_thin(distance: f32) -> f32 {
  let far_density = clamp(params.density_b.x, 0.0, 1.0);
  let d = max(distance, 0.0);
  let base = min(1.0, pow(58.0 / (d + 42.0), 1.15));
  let far = pow(min(1.0, 120.0 / max(d, 120.0)), 1.6);
  return clamp(base * far, far_density, 1.0);
}

fn edge_fade(wpos: vec2<f32>, height: f32, normal_y: f32) -> f32 {
  let sample_distance = max(0.75, params.settings_a.x * 1.25);
  let world_size = max(1.0, params.center_radius.w);
  let h0 = placement_ground_height(wpos.x + sample_distance, wpos.y, world_size);
  let h1 = placement_ground_height(wpos.x - sample_distance, wpos.y, world_size);
  let h2 = placement_ground_height(wpos.x, wpos.y + sample_distance, world_size);
  let h3 = placement_ground_height(wpos.x, wpos.y - sample_distance, world_size);
  let max_delta = max(max(abs(h0 - height), abs(h1 - height)), max(abs(h2 - height), abs(h3 - height)));
  let height_fade = 1.0 - smoothstep(1.5, 4.5, max_delta);
  let slope_fade = smoothstep(0.55, 0.9, normal_y);
  return clamp(height_fade * slope_fade, 0.0, 1.0);
}

fn in_frustum(center: vec3<f32>, slack: f32) -> bool {
  for (var p = 0u; p < 6u; p = p + 1u) {
    let plane = params.planes[p];
    if (dot(plane.xyz, center) + plane.w < -slack) { return false; }
  }
  return true;
}

fn append_candidate(tier: u32, wc: vec2<f32>, wpos: vec2<f32>, height: f32, normal: vec3<f32>, dist: f32, edge: f32, ring_edge: f32, thin: f32, river_height: f32) {
  let max_per_tier = params.counts_b.x;
  let slot = atomicAdd(&counters[tier], 1u);
  if (slot >= max_per_tier) { return; }
  let seed = params.counts_b.z;
  let max_width_mul = min(max(1.0, params.settings_b.w), GRASS_FAR_WIDTH_MUL_MAX);
  var height_mul = 1.0;
  var width_mul = clamp(1.0 / sqrt(thin), 1.0, max_width_mul);
  if (tier == TIER_MID) { height_mul = GRASS_MID_HEIGHT_MUL; }
  else if (tier == TIER_FAR) { height_mul = GRASS_FAR_HEIGHT_MUL; }
  else if (tier == TIER_SUPER) { height_mul = GRASS_SUPER_HEIGHT_MUL; width_mul = min(max_width_mul, width_mul * GRASS_SUPER_WIDTH_EXTRA); }
  let weights = material_weights_with_paint(height, normal.y, wpos.x, wpos.y);
  let bank = wet_bank(height, normal.y);
  let height_jit = pcg2d(wc, seed + 1501u).x * 2.0 - 1.0;
  let height_scale = max(0.1, 1.0 + height_jit * params.settings_a.z) * river_height;
  let yaw = pcg2d(wc, seed + 1709u).x * TAU;
  let phase = pcg2d(wc, seed + 1801u).x * TAU;
  let color_hash = pcg2d(wc, seed + 1901u).x;
  let color_mix = min(1.0, color_hash * color_hash + bank * 0.16 + weights.z * 0.12);
  let gust_k = pcg2d(wc, seed + 2003u).x * 0.6 + 0.7;
  let out_index = tier * max_per_tier + slot;
  out_offset[out_index] = vec4<f32>(wpos.x, height + 0.02, wpos.y, 1.0);
  out_packed0[out_index] = vec4<f32>(params.settings_a.y * height_scale * height_mul, yaw, phase, color_mix);
  out_packed1[out_index] = vec4<f32>(min(edge, ring_edge), normal.y, width_mul, f32(tier));
  out_normal[out_index] = vec4<f32>(normal, gust_k);
}

fn process_slot(slot: u32) {
  let grid = params.counts_b.y;
  // Keep density_a live so the pipeline layout stays stable across shader
  // variants.  Without this read, WGSL may strip the binding and misalign
  // the uniform offsets for variants that do consume it.
  _ = params.density_a;
  if (slot >= grid * grid || params.counts_b.x == 0u) { return; }
  let wc = world_cell(slot);
  let seed = params.counts_b.z;
  let jitter = (pcg2d(wc, seed + 1103u) - vec2<f32>(0.5, 0.5)) * params.density_b.w;
  let wpos = (wc + vec2<f32>(0.5, 0.5) + jitter) * params.settings_a.x;
  let world_max = params.center_radius.w;
  if (wpos.x <= 0.0 || wpos.y <= 0.0 || wpos.x >= world_max || wpos.y >= world_max) { return; }
  let dist = distance(wpos, params.center_radius.xy);
  if (dist > params.center_radius.z) { return; }
  let world_size = max(1.0, params.center_radius.w);
  let hydro = hydrology_at(wpos.x, wpos.y);
  let height = placement_ground_height(wpos.x, wpos.y, world_size);
  if (hydrology_reject_grass(hydro, height)) { return; }
  let normal = normalize(densityGradient(wpos.x, height, wpos.y));
  let mask = grass_mask(height, normal.y, dist, wpos.x, wpos.y, hydro);
  let thin = grass_thin(dist);
  let ring_edge = 1.0 - smoothstep(params.center_radius.z * 0.9, params.center_radius.z, dist);
  if (pcg2d(wc, seed + 1301u).x >= mask * ring_edge * thin) { return; }
  let edge = edge_fade(wpos, height, normal.y);
  if (edge < 0.18) { return; }
  if (!in_frustum(vec3<f32>(wpos.x, height + 0.5, wpos.y), 1.4)) { return; }
  let river_band = river_grass_ecology_band(wpos.x, wpos.y, hydro, height);
  let near_d = params.bands.x;
  let mid_d = params.bands.y;
  let far_d = params.bands.z;
  let band = params.bands.w;
  if (dist < near_d + band) { append_candidate(TIER_NEAR, wc, wpos, height, normal, dist, edge, ring_edge, thin, river_band.height); }
  if (dist >= near_d - band && dist < mid_d + band) { append_candidate(TIER_MID, wc, wpos, height, normal, dist, edge, ring_edge, thin, river_band.height); }
  if (dist >= mid_d - band && dist < far_d + band) { append_candidate(TIER_FAR, wc, wpos, height, normal, dist, edge, ring_edge, thin, river_band.height); }
  if (dist >= far_d - band) { append_candidate(TIER_SUPER, wc, wpos, height, normal, dist, edge, ring_edge, thin, river_band.height); }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn clear_counters(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < 4u) { atomicStore(&counters[i], 0u); }
  if (i < 20u) { indirect_args[i] = 0u; }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn grass_cull(@builtin(global_invocation_id) id: vec3<u32>) { process_slot(id.x); }

fn write_draw_args(tier: u32, index_count: u32, instance_count: u32) {
  let base = tier * INDIRECT_STRIDE_U32;
  indirect_args[base + 0u] = index_count;
  indirect_args[base + 1u] = min(instance_count, params.counts_b.x);
  indirect_args[base + 2u] = 0u;
  indirect_args[base + 3u] = 0u;
  indirect_args[base + 4u] = tier * params.counts_b.x;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn build_indirect_args(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) { return; }
  write_draw_args(TIER_NEAR, params.counts_a.x, atomicLoad(&counters[TIER_NEAR]));
  write_draw_args(TIER_MID, params.counts_a.y, atomicLoad(&counters[TIER_MID]));
  write_draw_args(TIER_FAR, params.counts_a.z, atomicLoad(&counters[TIER_FAR]));
  write_draw_args(TIER_SUPER, params.counts_a.w, atomicLoad(&counters[TIER_SUPER]));
}
