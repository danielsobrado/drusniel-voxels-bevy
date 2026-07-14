import { GPU_CLOD_WELD_WORKGROUP_SIZE } from "./gpu_clod_weld_compute.js";

/**
 * Experimental parent-page simplifier. It preserves footprint-border vertices and material seams,
 * but it is not a replacement for meshoptimizer until the CPU border/topology validator accepts
 * its output. The runtime flag remains disabled by default.
 */
export const GPU_CLOD_SIMPLIFY_WGSL = /* wgsl */ `
struct Vertex {
  position_paint : vec4<f32>,
  normal_reserved : vec4<f32>,
  weights : vec4<f32>,
};

struct SimplifyParams {
  vertex_count : u32,
  index_count : u32,
  hash_mask : u32,
  max_probe : u32,
  cluster_size : f32,
  border_epsilon : f32,
  normal_dot_min : f32,
  material_epsilon : f32,
  footprint_min : vec2<f32>,
  footprint_max : vec2<f32>,
};

struct HashSlot {
  key : atomic<u32>,
  value_plus_one : atomic<u32>,
};

struct SimplifyCounters {
  vertex_count : atomic<u32>,
  index_count : atomic<u32>,
  protected_vertices : atomic<u32>,
  attribute_conflicts : atomic<u32>,
  probe_failures : atomic<u32>,
  max_error_bits : atomic<u32>,
};

@group(0) @binding(0) var<uniform> params : SimplifyParams;
@group(0) @binding(1) var<storage, read> input_vertices : array<Vertex>;
@group(0) @binding(2) var<storage, read> input_indices : array<u32>;
@group(0) @binding(3) var<storage, read_write> hash_slots : array<HashSlot>;
@group(0) @binding(4) var<storage, read_write> vertex_remap : array<u32>;
@group(0) @binding(5) var<storage, read_write> output_vertices : array<Vertex>;
@group(0) @binding(6) var<storage, read_write> output_indices : array<u32>;
@group(0) @binding(7) var<storage, read_write> counters : SimplifyCounters;

fn hash_mix(value : u32) -> u32 {
  var x = value;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);
}

fn is_locked(position : vec3<f32>) -> bool {
  return abs(position.x - params.footprint_min.x) <= params.border_epsilon
    || abs(position.x - params.footprint_max.x) <= params.border_epsilon
    || abs(position.z - params.footprint_min.y) <= params.border_epsilon
    || abs(position.z - params.footprint_max.y) <= params.border_epsilon;
}

fn cluster_hash(position : vec3<f32>, vertex_id : u32, locked : bool) -> u32 {
  if (locked) { return max(1u, hash_mix(vertex_id ^ 0xa511e9b3u)); }
  let inv = 1.0 / max(params.cluster_size, 1e-6);
  let q = vec3<i32>(floor(position * inv));
  var h = hash_mix(bitcast<u32>(q.x));
  h = hash_mix(h ^ bitcast<u32>(q.y));
  h = hash_mix(h ^ bitcast<u32>(q.z));
  return max(1u, h);
}

fn attributes_match(a : Vertex, b : Vertex) -> bool {
  let normal_dot = dot(normalize(a.normal_reserved.xyz), normalize(b.normal_reserved.xyz));
  let material_delta = max(
    max(abs(a.weights.x - b.weights.x), abs(a.weights.y - b.weights.y)),
    max(abs(a.weights.z - b.weights.z), abs(a.weights.w - b.weights.w)),
  );
  let paint_match = abs(a.position_paint.w - b.position_paint.w) <= params.material_epsilon;
  return normal_dot >= params.normal_dot_min && material_delta <= params.material_epsilon && paint_match;
}

@compute @workgroup_size(${GPU_CLOD_WELD_WORKGROUP_SIZE})
fn simplify_vertices(@builtin(global_invocation_id) gid : vec3<u32>) {
  let vertex_id = gid.x;
  if (vertex_id >= params.vertex_count) { return; }
  let candidate = input_vertices[vertex_id];
  let locked = is_locked(candidate.position_paint.xyz);
  if (locked) { atomicAdd(&counters.protected_vertices, 1u); }
  let key = cluster_hash(candidate.position_paint.xyz, vertex_id, locked);
  let start = key & params.hash_mask;

  for (var probe = 0u; probe < params.max_probe; probe++) {
    let slot_index = (start + probe) & params.hash_mask;
    let claim = atomicCompareExchangeWeak(&hash_slots[slot_index].key, 0u, key);
    if (claim.exchanged) {
      let output_id = atomicAdd(&counters.vertex_count, 1u);
      output_vertices[output_id] = candidate;
      atomicStore(&hash_slots[slot_index].value_plus_one, output_id + 1u);
      vertex_remap[vertex_id] = output_id;
      return;
    }
    if (claim.old_value != key) { continue; }

    var value_plus_one = atomicLoad(&hash_slots[slot_index].value_plus_one);
    while (value_plus_one == 0u) {
      value_plus_one = atomicLoad(&hash_slots[slot_index].value_plus_one);
    }
    let output_id = value_plus_one - 1u;
    let representative = output_vertices[output_id];
    if (locked || !attributes_match(candidate, representative)) {
      if (!locked) { atomicAdd(&counters.attribute_conflicts, 1u); }
      continue;
    }
    let error = distance(candidate.position_paint.xyz, representative.position_paint.xyz);
    atomicMax(&counters.max_error_bits, bitcast<u32>(max(0.0, error)));
    vertex_remap[vertex_id] = output_id;
    return;
  }

  atomicAdd(&counters.probe_failures, 1u);
  vertex_remap[vertex_id] = 0xffffffffu;
}

@compute @workgroup_size(${GPU_CLOD_WELD_WORKGROUP_SIZE})
fn simplify_triangles(@builtin(global_invocation_id) gid : vec3<u32>) {
  let triangle_id = gid.x;
  let source = triangle_id * 3u;
  if (source + 2u >= params.index_count) { return; }
  let a = vertex_remap[input_indices[source]];
  let b = vertex_remap[input_indices[source + 1u]];
  let c = vertex_remap[input_indices[source + 2u]];
  if (a == 0xffffffffu || b == 0xffffffffu || c == 0xffffffffu) { return; }
  if (a == b || b == c || a == c) { return; }
  let target = atomicAdd(&counters.index_count, 3u);
  output_indices[target] = a;
  output_indices[target + 1u] = b;
  output_indices[target + 2u] = c;
}
`;
