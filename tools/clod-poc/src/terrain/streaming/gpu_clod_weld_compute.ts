import type { PageMesh } from "../../types.js";

export const GPU_CLOD_PACKED_VERTEX_FLOATS = 12;
export const GPU_CLOD_PACKED_VERTEX_BYTES = GPU_CLOD_PACKED_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const GPU_CLOD_WELD_WORKGROUP_SIZE = 64;

export interface GpuClodWeldParams {
  weldEpsilon: number;
  normalDotMin: number;
  materialEpsilon: number;
  maxProbe: number;
}

export interface PackedGpuClodMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Packs a page mesh into the 48-byte vertex format consumed by the GPU weld/simplify kernels.
 * position.w carries the paint slot; normal.w is reserved; weights carry four material channels.
 */
export function packGpuClodMesh(mesh: PageMesh): PackedGpuClodMesh {
  const vertexCount = mesh.positions.length / 3;
  if (mesh.normals.length !== vertexCount * 3) throw new Error("GPU CLOD pack requires one normal per vertex");
  if (mesh.paintSlots.length !== vertexCount) throw new Error("GPU CLOD pack requires one paint slot per vertex");
  if (mesh.materialWeightStride !== 4 || mesh.materialWeights.length !== vertexCount * 4) {
    throw new Error("GPU CLOD pack currently requires four material weights per vertex");
  }
  const vertices = new Float32Array(vertexCount * GPU_CLOD_PACKED_VERTEX_FLOATS);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const source3 = vertex * 3;
    const source4 = vertex * 4;
    const target = vertex * GPU_CLOD_PACKED_VERTEX_FLOATS;
    vertices[target] = mesh.positions[source3]!;
    vertices[target + 1] = mesh.positions[source3 + 1]!;
    vertices[target + 2] = mesh.positions[source3 + 2]!;
    vertices[target + 3] = mesh.paintSlots[vertex]!;
    vertices[target + 4] = mesh.normals[source3]!;
    vertices[target + 5] = mesh.normals[source3 + 1]!;
    vertices[target + 6] = mesh.normals[source3 + 2]!;
    vertices[target + 7] = 0;
    vertices[target + 8] = mesh.materialWeights[source4]!;
    vertices[target + 9] = mesh.materialWeights[source4 + 1]!;
    vertices[target + 10] = mesh.materialWeights[source4 + 2]!;
    vertices[target + 11] = mesh.materialWeights[source4 + 3]!;
  }
  return { vertices, indices: mesh.indices };
}

/**
 * Hash weld with attribute-conflict preservation. Equal quantized positions only merge when
 * normals and material weights satisfy the same tolerances as the CPU page builder.
 */
export const GPU_CLOD_WELD_WGSL = /* wgsl */ `
struct Vertex {
  position_paint : vec4<f32>,
  normal_reserved : vec4<f32>,
  weights : vec4<f32>,
};

struct WeldParams {
  vertex_count : u32,
  index_count : u32,
  hash_mask : u32,
  max_probe : u32,
  weld_epsilon : f32,
  normal_dot_min : f32,
  material_epsilon : f32,
  _pad0 : f32,
};

struct HashSlot {
  key : atomic<u32>,
  value_plus_one : atomic<u32>,
};

struct WeldCounters {
  vertex_count : atomic<u32>,
  index_count : atomic<u32>,
  attribute_conflicts : atomic<u32>,
  probe_failures : atomic<u32>,
};

@group(0) @binding(0) var<uniform> params : WeldParams;
@group(0) @binding(1) var<storage, read> input_vertices : array<Vertex>;
@group(0) @binding(2) var<storage, read> input_indices : array<u32>;
@group(0) @binding(3) var<storage, read_write> hash_slots : array<HashSlot>;
@group(0) @binding(4) var<storage, read_write> vertex_remap : array<u32>;
@group(0) @binding(5) var<storage, read_write> output_vertices : array<Vertex>;
@group(0) @binding(6) var<storage, read_write> output_indices : array<u32>;
@group(0) @binding(7) var<storage, read_write> counters : WeldCounters;

fn hash_mix(value : u32) -> u32 {
  var x = value;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);
}

fn quantized_hash(position : vec3<f32>) -> u32 {
  let inv = 1.0 / max(params.weld_epsilon, 1e-9);
  let q = vec3<i32>(round(position * inv));
  var h = hash_mix(bitcast<u32>(q.x));
  h = hash_mix(h ^ bitcast<u32>(q.y));
  h = hash_mix(h ^ bitcast<u32>(q.z));
  return max(1u, h);
}

fn positions_match(a : Vertex, b : Vertex) -> bool {
  return all(abs(a.position_paint.xyz - b.position_paint.xyz) <= vec3<f32>(params.weld_epsilon));
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
fn weld_vertices(@builtin(global_invocation_id) gid : vec3<u32>) {
  let vertex_id = gid.x;
  if (vertex_id >= params.vertex_count) { return; }
  let candidate = input_vertices[vertex_id];
  let key = quantized_hash(candidate.position_paint.xyz);
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
    let existing = output_vertices[output_id];
    if (!positions_match(candidate, existing)) { continue; }
    if (!attributes_match(candidate, existing)) {
      atomicAdd(&counters.attribute_conflicts, 1u);
      continue;
    }
    vertex_remap[vertex_id] = output_id;
    return;
  }

  atomicAdd(&counters.probe_failures, 1u);
  vertex_remap[vertex_id] = 0xffffffffu;
}

@compute @workgroup_size(${GPU_CLOD_WELD_WORKGROUP_SIZE})
fn compact_triangles(@builtin(global_invocation_id) gid : vec3<u32>) {
  let triangle_id = gid.x;
  let source = triangle_id * 3u;
  if (source + 2u >= params.index_count) { return; }
  let a = vertex_remap[input_indices[source]];
  let b = vertex_remap[input_indices[source + 1u]];
  let c = vertex_remap[input_indices[source + 2u]];
  if (a == 0xffffffffu || b == 0xffffffffu || c == 0xffffffffu) { return; }
  if (a == b || b == c || a == c) { return; }
  let write_base = atomicAdd(&counters.index_count, 3u);
  output_indices[write_base] = a;
  output_indices[write_base + 1u] = b;
  output_indices[write_base + 2u] = c;
}
`;
