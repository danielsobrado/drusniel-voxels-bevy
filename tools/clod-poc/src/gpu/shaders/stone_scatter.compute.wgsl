const WORKGROUP_SIZE: u32 = 64u;
const CLASS_LARGE: u32 = 0u;
const CLASS_MEDIUM: u32 = 1u;
const CLASS_SMALL: u32 = 2u;
const COUNTER_TOTAL: u32 = 0u;
const TAU: f32 = 6.28318530718;
const INDIRECT_STRIDE_U32: u32 = 5u;

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
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indirect_args: array<u32>;
@group(0) @binding(3) var<storage, read_write> instance_a: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> instance_b: array<vec4<f32>>;

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

// Base mesh radius of the rock_builder presets used per class (talus for large, cobble
// otherwise). scale = target_radius / base_radius, so these must track buildRock preset sizes
// in src/stones/rock_builder.ts (DRAW_PRESET/DRAW_DETAIL in stone_instances.ts).
fn class_base_radius(cls: u32) -> f32 {
  if (cls == CLASS_LARGE) {
    return 0.95;
  }
  return 0.16;
}

fn pick_class(site_scree: f32, streambed: f32, cliff_above: f32, roll: f32) -> u32 {
  let large_bias = 1.0 + site_scree + cliff_above + streambed * params.slope_water.w * 6.0;
  let w_large = 0.1 * large_bias;
  let w_medium = 0.32;
  let w_small = 0.58;
  let class_pick = roll * (w_large + w_medium + w_small);
  if (class_pick < w_large) {
    return CLASS_LARGE;
  }
  if (class_pick < w_large + w_medium) {
    return CLASS_MEDIUM;
  }
  return CLASS_SMALL;
}

fn process_cell(slot: u32) {
  let grid = params.counts_a.y;
  let max_instances = params.counts_a.x;
  if (slot >= grid * grid || max_instances == 0u || params.world.z <= 0.0) {
    return;
  }

  let cell = vec2<f32>(f32(slot % grid), f32(slot / grid));
  let seed = params.counts_a.z;
  let jitter = pcg2d(cell, seed + 101u);
  let wpos = (cell + jitter) * params.world.y;
  if (wpos.x <= 0.0 || wpos.y <= 0.0 || wpos.x >= params.world.x || wpos.y >= params.world.x) {
    return;
  }

  let h = surfaceHeightField(wpos.x, wpos.y);
  let normal = normalize(densityGradient(wpos.x, h, wpos.y));
  let weights = material_weights(h);
  let rock = weights.y;
  let sand = weights.z;
  let snow = weights.w;

  if (h < WATER_LEVEL + params.slope_water.z) {
    return;
  }
  let denom = max(0.001, params.slope_water.x - params.slope_water.y);
  let repose = clamp((normal.y - params.slope_water.y) / denom, 0.0, 1.0);
  if (repose <= 0.0) {
    return;
  }
  let scree = clamp((params.slope_water.x - normal.y) / denom, 0.0, 1.0) * repose;
  let streambed = stone_smooth_range(params.stream_snow_lean.x, params.stream_snow_lean.y, sand);

  let n_xz_len = max(0.0001, length(normal.xz));
  let uphill = -normal.xz / n_xz_len;
  let h_near = surfaceHeightField(wpos.x + uphill.x * params.cliff.x, wpos.y + uphill.y * params.cliff.x);
  let h_far = surfaceHeightField(wpos.x + uphill.x * params.cliff.y, wpos.y + uphill.y * params.cliff.y);
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
  let accept = params.world.z * base * clump * repose * (1.0 - snow * params.stream_snow_lean.z);
  if (pcg2d(cell, seed + 307u).x >= accept) {
    return;
  }

  let total_slot = atomicAdd(&counters[COUNTER_TOTAL], 1u);
  if (total_slot >= max_instances) {
    return;
  }

  let cls = pick_class(scree, streambed, cliff_above, pcg2d(cell, seed + 523u).x);
  let class_slot = atomicAdd(&counters[cls + 1u], 1u);
  if (class_slot >= max_instances) {
    return;
  }

  let cfg = class_radius(cls);
  let radius_hash = pcg2d(cell, seed + 859u).x;
  let target_radius = cfg.x + (cfg.y - cfg.x) * radius_hash;
  let scale = target_radius / class_base_radius(cls);
  let slope_amt = 1.0 - normal.y;
  let y = h - cfg.z * target_radius * (1.0 + slope_amt * params.weights_b.w);
  let yaw = pcg2d(cell, seed + 536u).x * TAU;
  let lean = vec2<f32>(normal.z, -normal.x) * params.stream_snow_lean.w * slope_amt;
  let out_index = cls * max_instances + class_slot;
  instance_a[out_index] = vec4<f32>(wpos.x, y, wpos.y, scale);
  instance_b[out_index] = vec4<f32>(yaw, lean.x, lean.y, f32(cls));
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn clear_counters(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < 4u) {
    atomicStore(&counters[i], 0u);
  }
  if (i < 15u) {
    indirect_args[i] = 0u;
  }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn scatter_stones(@builtin(global_invocation_id) id: vec3<u32>) {
  process_cell(id.x);
}

fn write_draw_args(cls: u32, index_count: u32, instance_count: u32) {
  let base = cls * INDIRECT_STRIDE_U32;
  indirect_args[base + 0u] = index_count;
  indirect_args[base + 1u] = min(instance_count, params.counts_a.x);
  indirect_args[base + 2u] = 0u;
  indirect_args[base + 3u] = 0u;
  indirect_args[base + 4u] = cls * params.counts_a.x;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn build_indirect_args(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) {
    return;
  }
  write_draw_args(CLASS_LARGE, params.counts_a.w, atomicLoad(&counters[1u]));
  write_draw_args(CLASS_MEDIUM, params.counts_b.x, atomicLoad(&counters[2u]));
  write_draw_args(CLASS_SMALL, params.counts_b.y, atomicLoad(&counters[3u]));
}
