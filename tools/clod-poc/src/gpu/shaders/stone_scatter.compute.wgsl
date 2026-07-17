const WORKGROUP_SIZE: u32 = 64u;
const CLASS_LARGE: u32 = 0u;
const CLASS_MEDIUM: u32 = 1u;
const CLASS_SMALL: u32 = 2u;
const COUNTER_ACCEPTED_TOTAL: u32 = 0u;
const COUNTER_CLASS_LARGE: u32 = 1u;
const COUNTER_CLASS_MEDIUM: u32 = 2u;
const COUNTER_CLASS_SMALL: u32 = 3u;
const COUNTER_CANDIDATES_TOTAL: u32 = 4u;
const COUNTER_REJECT_OUTSIDE_WORLD: u32 = 5u;
const COUNTER_REJECT_TOO_FAR: u32 = 6u;
const COUNTER_REJECT_BELOW_WATER: u32 = 7u;
const COUNTER_REJECT_TOO_STEEP: u32 = 8u;
const COUNTER_REJECT_DENSITY_MASK: u32 = 9u;
const COUNTER_REJECT_TILE_BUDGET: u32 = 10u;
const COUNTER_REJECT_CLASS_BUDGET: u32 = 11u;
const STONE_COUNTER_COUNT: u32 = 12u;
// View-pass per-group counters live after the scatter counters in the same buffer.
const STONE_VIEW_COUNTER_BASE: u32 = 12u;
const STONE_MAX_GROUPS: u32 = 32u;
const TAU: f32 = 6.28318530718;
const INDIRECT_STRIDE_U32: u32 = 5u;
const STONE_HYDRO_WATER_CLEARANCE: f32 = 0.22;
// Packed source meta: source_b.w = variant * STONE_META_VARIANT_SCALE + sink_depth.
const STONE_META_VARIANT_SCALE: f32 = 32.0;

struct Params {
  world: vec4<f32>,
  slope_water: vec4<f32>,
  cliff: vec4<f32>,
  stream_snow_lean: vec4<f32>,
  weights_a: vec4<f32>,
  weights_b: vec4<f32>,
  class_large: vec4<f32>,
  class_medium: vec4<f32>,
  class_small: vec4<f32>,
  counts_a: vec4<u32>,
  counts_b: vec4<u32>,
  ring: vec4<f32>,
  terrain_grass: vec4<f32>,
  terrain_rock: vec4<f32>,
  terrain_sand: vec4<f32>,
  terrain_snow: vec4<f32>,
  terrain_low: vec4<f32>,
  terrain_mid: vec4<f32>,
  terrain_high: vec4<f32>,
  terrain_height: vec4<f32>,
  hydro_atlas: vec4<f32>,
  // View pass: x = per-group draw capacity, y = group count, z = source class capacity.
  view_counts: vec4<u32>,
  camera: vec4<f32>,
  frustum: array<vec4<f32>, 6>,
  // Per class: (max_distance_m, lod_near_m, lod_count, group_base).
  class_view: array<vec4<f32>, 3>,
  // Per class variant counts in xyz.
  class_variants: vec4<f32>,
  group_index_counts: array<vec4<u32>, 8>,
};

struct StoneHydrologySample {
  water_y: f32,
  wet_mask: f32,
  carved_bed: f32,
  enabled: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indirect_args: array<u32>;
@group(0) @binding(3) var<storage, read_write> instance_a: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> instance_b: array<vec4<f32>>;
@group(0) @binding(13) var<storage, read_write> source_a: array<vec4<f32>>;
@group(0) @binding(14) var<storage, read_write> source_b: array<vec4<f32>>;

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

fn stone_world_cell(slot: u32) -> vec2<f32> {
  let grid = max(params.counts_a.y, 1u);
  let cell_size = max(params.world.y, 0.001);
  let sx = f32(slot % grid);
  let sz = f32(slot / grid);
  let center_cell = params.ring.xy / cell_size;
  return vec2<f32>(
    round((center_cell.x - sx) / f32(grid)) * f32(grid) + sx,
    round((center_cell.y - sz) / f32(grid)) * f32(grid) + sz,
  );
}

fn placement_hydro_atlas_params() -> vec4<f32> {
  return params.hydro_atlas;
}

fn hydrology_at(wx: f32, wz: f32) -> StoneHydrologySample {
  let dims = textureDimensions(hydro_texture);
  if (dims.x <= 1u || dims.y <= 1u) {
    return StoneHydrologySample(0.0, 0.0, 0.0, 0.0);
  }
  let world_size = max(1.0, params.world.x);
  if (!placement_inside_startup_world(wx, wz, world_size) && placement_hydro_atlas_enabled()) {
    let atlas = placement_sample_hydro_atlas(wx, wz);
    if (!placement_hydro_sample_valid(atlas)) {
      return StoneHydrologySample(0.0, 0.0, 0.0, 0.0);
    }
    return StoneHydrologySample(atlas.x, atlas.y, atlas.z, 1.0);
  }
  let uv = clamp(vec2<f32>(wx, wz) / world_size, vec2<f32>(0.0), vec2<f32>(1.0));
  let h = textureSampleLevel(hydro_texture, hydro_sampler, uv, 0.0);
  return StoneHydrologySample(h.x, h.y, h.z, 1.0);
}

fn hydrology_ground_height(raw_height: f32, hydro: StoneHydrologySample) -> f32 {
  if (hydro.enabled < 0.5) {
    return raw_height;
  }
  return hydro.carved_bed;
}

fn hydrology_reject_stone(hydro: StoneHydrologySample, ground_height: f32) -> bool {
  if (hydro.enabled < 0.5 || hydro.wet_mask <= 0.05) {
    return false;
  }
  return ground_height <= hydro.water_y + STONE_HYDRO_WATER_CLEARANCE;
}

fn hydrology_streambed_mask(hydro: StoneHydrologySample, ground_height: f32) -> f32 {
  if (hydro.enabled < 0.5 || hydro.wet_mask <= 0.001) {
    return 0.0;
  }
  let above_water = ground_height - hydro.water_y;
  let dry_edge = smoothstep(STONE_HYDRO_WATER_CLEARANCE, 1.5, above_water);
  let outer_fade = 1.0 - smoothstep(7.0, 18.0, above_water);
  return clamp(dry_edge * outer_fade, 0.0, 1.0);
}

fn material_weights(height: f32) -> vec4<f32> {
  let sand = max(0.0, 1.0 - abs(height - WATER_LEVEL) / 6.0);
  let snow = max(0.0, (height - 88.0) / 22.0);
  let rock = clamp((height - 48.0) / 34.0, 0.0, 1.0) * (1.0 - snow);
  let grass = max(0.0, 1.0 - sand - snow - rock);
  let sum = max(1e-5, grass + rock + sand + snow);
  return vec4<f32>(grass, rock, sand, snow) / sum;
}

fn stone_smooth_range(edge0: f32, edge1: f32, value: f32) -> f32 {
  if (abs(edge1 - edge0) <= 0.000001) {
    return select(0.0, 1.0, value >= edge1);
  }
  let t = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn class_radius(cls: u32) -> vec4<f32> {
  if (cls == CLASS_LARGE) {
    return params.class_large;
  }
  if (cls == CLASS_MEDIUM) {
    return params.class_medium;
  }
  return params.class_small;
}

fn class_base_radius(cls: u32) -> f32 {
  if (cls == CLASS_LARGE) {
    return 0.95;
  }
  return 0.16;
}

fn class_view_config(cls: u32) -> vec4<f32> {
  return params.class_view[min(cls, 2u)];
}

fn class_variant_count(cls: u32) -> u32 {
  var count: f32;
  if (cls == CLASS_LARGE) {
    count = params.class_variants.x;
  } else if (cls == CLASS_MEDIUM) {
    count = params.class_variants.y;
  } else {
    count = params.class_variants.z;
  }
  return max(1u, u32(count));
}

fn blend_terrain_class_weights(weights: vec4<f32>, grass: vec4<f32>, rock: vec4<f32>, sand: vec4<f32>, snow: vec4<f32>) -> vec4<f32> {
  let sum = max(0.00001, weights.x + weights.y + weights.z + weights.w);
  return (grass * weights.x + rock * weights.y + sand * weights.z + snow * weights.w) / sum;
}

fn height_terrain_weights(height: f32) -> vec4<f32> {
  let blend = max(0.001, params.terrain_height.z);
  let low_weight = 1.0 - smoothstep(params.terrain_height.x - blend, params.terrain_height.x + blend, height);
  let high_weight = smoothstep(params.terrain_height.y - blend, params.terrain_height.y + blend, height);
  let mid_weight = max(0.0, 1.0 - low_weight - high_weight);
  let sum = max(0.00001, low_weight + mid_weight + high_weight);
  return (params.terrain_low * low_weight + params.terrain_mid * mid_weight + params.terrain_high * high_weight) / sum;
}

fn terrain_bias(height: f32, weights: vec4<f32>) -> vec4<f32> {
  let material = blend_terrain_class_weights(weights, params.terrain_grass, params.terrain_rock, params.terrain_sand, params.terrain_snow);
  let height_bias = height_terrain_weights(height);
  return material * height_bias;
}

fn pick_class(site_scree: f32, streambed: f32, cliff_above: f32, terrain: vec4<f32>, roll: f32) -> u32 {
  let large_bias = 1.0 + site_scree + cliff_above + streambed * params.slope_water.w * 6.0;
  let w_large = 0.1 * large_bias * terrain.y;
  let w_medium = 0.32 * terrain.z;
  let w_small = 0.58 * terrain.w;
  let class_pick = roll * (w_large + w_medium + w_small);
  if (class_pick < w_large) {
    return CLASS_LARGE;
  }
  if (class_pick < w_large + w_medium) {
    return CLASS_MEDIUM;
  }
  return CLASS_SMALL;
}

fn ring_edge_fade(dist: f32) -> f32 {
  let radius = max(params.ring.z, 0.001);
  let fade_m = clamp(params.ring.w, 0.0, radius);
  if (fade_m <= 0.0001) {
    return select(1.0, 0.0, dist > radius);
  }
  return 1.0 - smoothstep(radius - fade_m, radius, dist);
}

fn process_cell(slot: u32) {
  let grid = params.counts_a.y;
  let max_instances = params.counts_a.x;
  if (slot >= grid * grid || max_instances == 0u || params.world.z <= 0.0) {
    return;
  }

  atomicAdd(&counters[COUNTER_CANDIDATES_TOTAL], 1u);
  let wc = stone_world_cell(slot);
  let seed = params.counts_a.z;
  let jitter = pcg2d(wc, seed + 101u);
  let wpos = (wc + jitter) * params.world.y;
  // See grass_ring.compute.wgsl: the finite [0, world] box only bounds a finite world. Island worlds
  // have real terrain outside the startup square, so skip the box reject there and let the scatter
  // masks decide; otherwise stones form a fixed disc at the startup world edge.
  if (fieldParams.islandEnabled == 0u && (wpos.x <= 0.0 || wpos.y <= 0.0 || wpos.x >= params.world.x || wpos.y >= params.world.x)) {
    atomicAdd(&counters[COUNTER_REJECT_OUTSIDE_WORLD], 1u);
    return;
  }

  let dist = distance(wpos, params.ring.xy);
  if (dist > params.ring.z) {
    atomicAdd(&counters[COUNTER_REJECT_TOO_FAR], 1u);
    return;
  }

  let world_size = params.world.x;
  let hydro = hydrology_at(wpos.x, wpos.y);
  let h = placement_ground_height(wpos.x, wpos.y, world_size);
  let normal = placement_ground_normal(wpos.x, wpos.y, world_size, max(0.5, params.world.y));
  let weights = material_weights(h);
  let rock = weights.y;
  let sand = weights.z;
  let snow = weights.w;
  let terrain = terrain_bias(h, weights);
  let hydro_streambed = hydrology_streambed_mask(hydro, h);

  if (h < WATER_LEVEL + params.slope_water.z || hydrology_reject_stone(hydro, h)) {
    atomicAdd(&counters[COUNTER_REJECT_BELOW_WATER], 1u);
    return;
  }
  let denom = max(0.001, params.slope_water.x - params.slope_water.y);
  let repose = clamp((normal.y - params.slope_water.y) / denom, 0.0, 1.0);
  if (repose <= 0.0) {
    atomicAdd(&counters[COUNTER_REJECT_TOO_STEEP], 1u);
    return;
  }
  let scree = clamp((params.slope_water.x - normal.y) / denom, 0.0, 1.0) * repose;
  let streambed = max(stone_smooth_range(params.stream_snow_lean.x, params.stream_snow_lean.y, sand), hydro_streambed);

  let n_xz_len = max(0.0001, length(normal.xz));
  let uphill = -normal.xz / n_xz_len;
  let h_near = placement_ground_height(wpos.x + uphill.x * params.cliff.x, wpos.y + uphill.y * params.cliff.x, world_size);
  let h_far = placement_ground_height(wpos.x + uphill.x * params.cliff.y, wpos.y + uphill.y * params.cliff.y, world_size);
  let rise_near = (h_near - h) / max(0.001, params.cliff.x);
  let rise_far = (h_far - h_near) / max(0.001, params.cliff.y - params.cliff.x);
  let cliff_above = stone_smooth_range(params.cliff.z, params.cliff.w, max(rise_near, rise_far));

  let clump_cell = max(1.0, params.world.y * params.weights_b.z);
  let clump = params.weights_b.y + pcg2d(floor(wpos / clump_cell), seed + 419u).x;
  let base = rock * params.weights_a.x
    + scree * params.weights_a.y
    + cliff_above * params.weights_a.z
    + streambed * params.weights_a.w
    + params.weights_b.x;
  let ring_edge = ring_edge_fade(dist);
  let accept = params.world.z * base * clump * repose * terrain.x * ring_edge * (1.0 - snow * params.stream_snow_lean.z);
  if (pcg2d(wc, seed + 307u).x >= accept) {
    atomicAdd(&counters[COUNTER_REJECT_DENSITY_MASK], 1u);
    return;
  }

  let cls = pick_class(scree, streambed, cliff_above, terrain, pcg2d(wc, seed + 523u).x);
  // Honor per-class draw distance at scatter time so far ring cells never spend
  // budget on classes that can only be seen close up (e.g. small stones).
  if (dist > class_view_config(cls).x) {
    atomicAdd(&counters[COUNTER_REJECT_TOO_FAR], 1u);
    return;
  }

  let total_slot = atomicAdd(&counters[COUNTER_ACCEPTED_TOTAL], 1u);
  if (total_slot >= max_instances) {
    atomicAdd(&counters[COUNTER_REJECT_TILE_BUDGET], 1u);
    return;
  }

  let class_slot = atomicAdd(&counters[cls + 1u], 1u);
  if (class_slot >= max_instances) {
    atomicAdd(&counters[COUNTER_REJECT_CLASS_BUDGET], 1u);
    return;
  }

  let cfg = class_radius(cls);
  let radius_hash = pcg2d(wc, seed + 859u).x;
  let target_radius = cfg.x + (cfg.y - cfg.x) * radius_hash;
  let scale = target_radius / class_base_radius(cls);
  let slope_amt = 1.0 - normal.y;
  let sink_depth = cfg.z * target_radius * (1.0 + slope_amt * params.weights_b.w);
  let y = h - sink_depth;
  let yaw = pcg2d(wc, seed + 536u).x * TAU;
  let lean = vec2<f32>(normal.z, -normal.x) * params.stream_snow_lean.w * slope_amt;
  let variant = min(
    class_variant_count(cls) - 1u,
    u32(pcg2d(wc, seed + 941u).x * f32(class_variant_count(cls))),
  );
  let out_index = cls * max_instances + class_slot;
  source_a[out_index] = vec4<f32>(wpos.x, y, wpos.y, scale);
  source_b[out_index] = vec4<f32>(yaw, lean.x, lean.y, f32(variant) * STONE_META_VARIANT_SCALE + sink_depth);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn clear_counters(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < STONE_COUNTER_COUNT) {
    atomicStore(&counters[i], 0u);
  }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn scatter_stones(@builtin(global_invocation_id) id: vec3<u32>) {
  process_cell(id.x);
}

fn view_frustum_accept(center: vec3<f32>, radius: f32) -> bool {
  for (var p = 0u; p < 6u; p = p + 1u) {
    let plane = params.frustum[p];
    if (dot(plane.xyz, center) + plane.w < -radius) {
      return false;
    }
  }
  return true;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn clear_view_counters(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.view_counts.y) {
    atomicStore(&counters[STONE_VIEW_COUNTER_BASE + id.x], 0u);
  }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn cull_stones(@builtin(global_invocation_id) id: vec3<u32>) {
  let class_cap = params.view_counts.z;
  if (class_cap == 0u || id.x >= class_cap * 3u) {
    return;
  }
  let cls = id.x / class_cap;
  let slot = id.x % class_cap;
  let produced = min(atomicLoad(&counters[cls + 1u]), class_cap);
  if (slot >= produced) {
    return;
  }
  let src_a = source_a[id.x];
  let src_b = source_b[id.x];
  let pos = vec3<f32>(src_a.x, src_a.y, src_a.z);
  let cv = class_view_config(cls);
  let dist = distance(pos.xz, params.camera.xz);
  if (dist > cv.x) {
    return;
  }
  let radius = max(0.05, src_a.w * class_base_radius(cls));
  if (!view_frustum_accept(pos + vec3<f32>(0.0, radius, 0.0), radius * 2.0 + 1.0)) {
    return;
  }
  var lod = 0u;
  if (u32(cv.z) > 1u && dist >= cv.y) {
    lod = 1u;
  }
  let variant = u32(floor(src_b.w / STONE_META_VARIANT_SCALE));
  let sink_depth = src_b.w - f32(variant) * STONE_META_VARIANT_SCALE;
  let group = u32(cv.w) + variant * u32(cv.z) + lod;
  let group_cap = params.view_counts.x;
  let draw_slot = atomicAdd(&counters[STONE_VIEW_COUNTER_BASE + group], 1u);
  if (draw_slot >= group_cap) {
    return;
  }
  let draw_index = group * group_cap + draw_slot;
  instance_a[draw_index] = src_a;
  instance_b[draw_index] = vec4<f32>(src_b.x, src_b.y, src_b.z, sink_depth);
}

fn group_index_count(group: u32) -> u32 {
  let entry = params.group_index_counts[group / 4u];
  let lane = group % 4u;
  if (lane == 0u) {
    return entry.x;
  }
  if (lane == 1u) {
    return entry.y;
  }
  if (lane == 2u) {
    return entry.z;
  }
  return entry.w;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn build_indirect_args(@builtin(global_invocation_id) id: vec3<u32>) {
  let group = id.x;
  if (group >= params.view_counts.y) {
    return;
  }
  let group_cap = params.view_counts.x;
  let count = min(atomicLoad(&counters[STONE_VIEW_COUNTER_BASE + group]), group_cap);
  let base = group * INDIRECT_STRIDE_U32;
  indirect_args[base + 0u] = group_index_count(group);
  indirect_args[base + 1u] = count;
  indirect_args[base + 2u] = 0u;
  indirect_args[base + 3u] = 0u;
  indirect_args[base + 4u] = group * group_cap;
}
