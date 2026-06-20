const WORKGROUP_SIZE: u32 = 64u;
const TIER_NEAR: u32 = 0u;
const TIER_MID: u32 = 1u;
const TIER_FAR: u32 = 2u;
const TIER_SUPER: u32 = 3u;
const INDIRECT_STRIDE_U32: u32 = 5u;

struct Candidate {
  pos_height: vec4<f32>,
  normal_edge: vec4<f32>,
  misc: vec4<f32>,
};

struct Params {
  center_radius: vec4<f32>,
  bands: vec4<f32>,
  counts_a: vec4<u32>,
  counts_b: vec4<u32>,
};

@group(0) @binding(0) var<storage, read> candidates: array<Candidate>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> indirect_args: array<u32>;
@group(0) @binding(4) var<storage, read_write> out_offset: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> out_packed0: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> out_packed1: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> out_normal: array<vec4<f32>>;

fn candidate_distance(index: u32) -> f32 {
  let p = candidates[index].pos_height;
  let dx = p.x - params.center_radius.x;
  let dz = p.z - params.center_radius.y;
  return sqrt(dx * dx + dz * dz);
}

fn accept_candidate(index: u32, min_dist: f32, max_dist: f32) -> bool {
  if (index >= params.counts_a.x) {
    return false;
  }
  let dist = candidate_distance(index);
  return dist >= min_dist && dist <= max_dist;
}

fn grass_thin(distance: f32) -> f32 {
  let base = pow(min(1.0, 58.0 / (max(1.0, distance) + 42.0)), 1.15);
  let far = pow(120.0 / max(distance, 120.0), 1.6);
  return clamp(base * far, 0.02, 1.0);
}

fn write_candidate(tier: u32, slot: u32, index: u32, dist: f32) {
  let c = candidates[index];
  let out_index = tier * params.counts_b.y + slot;
  let thin = grass_thin(dist);
  var height_mul = 1.0;
  var width_mul = clamp(1.0 / sqrt(thin), 1.0, 4.0);
  if (tier == TIER_MID) {
    height_mul = 1.35;
  } else if (tier == TIER_FAR) {
    height_mul = 1.75;
  } else if (tier == TIER_SUPER) {
    height_mul = 2.25;
    width_mul = min(4.8, width_mul * 1.35);
  }

  let offset = vec4<f32>(c.pos_height.xyz, 1.0);
  let packed0 = vec4<f32>(c.pos_height.w * height_mul, c.misc.y, c.misc.z, c.misc.w);
  let packed1 = vec4<f32>(c.normal_edge.w, c.normal_edge.y, width_mul, 0.0);
  let normal = vec4<f32>(c.normal_edge.xyz, 0.0);

  out_offset[out_index] = offset;
  out_packed0[out_index] = packed0;
  out_packed1[out_index] = packed1;
  out_normal[out_index] = normal;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn clear_counters(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < 4u) {
    atomicStore(&counters[i], 0u);
  }
  if (i < 20u) {
    indirect_args[i] = 0u;
  }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn grass_cull_fine(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (!accept_candidate(index, 0.0, params.bands.y)) {
    return;
  }
  let dist = candidate_distance(index);
  let tier = select(TIER_MID, TIER_NEAR, dist <= params.bands.x);
  let slot = atomicAdd(&counters[tier], 1u);
  write_candidate(tier, slot, index, dist);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn grass_cull_far(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (!accept_candidate(index, params.bands.y, params.center_radius.z)) {
    return;
  }
  let dist = candidate_distance(index);
  let tier = select(TIER_SUPER, TIER_FAR, dist <= params.bands.z);
  let slot = atomicAdd(&counters[tier], 1u);
  write_candidate(tier, slot, index, dist);
}

fn write_draw_args(tier: u32, index_count: u32, instance_count: u32) {
  let base = tier * INDIRECT_STRIDE_U32;
  indirect_args[base + 0u] = index_count;
  indirect_args[base + 1u] = instance_count;
  indirect_args[base + 2u] = 0u;
  indirect_args[base + 3u] = 0u;
  indirect_args[base + 4u] = tier * params.counts_b.y;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn build_indirect_args(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) {
    return;
  }
  write_draw_args(TIER_NEAR, params.counts_a.y, atomicLoad(&counters[TIER_NEAR]));
  write_draw_args(TIER_MID, params.counts_a.z, atomicLoad(&counters[TIER_MID]));
  write_draw_args(TIER_FAR, params.counts_a.w, atomicLoad(&counters[TIER_FAR]));
  write_draw_args(TIER_SUPER, params.counts_b.x, atomicLoad(&counters[TIER_SUPER]));
}
