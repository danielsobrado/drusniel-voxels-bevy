const INDIRECT_STRIDE_U32: u32 = 5u;
const LOD_LIMIT: u32 = 4u;

struct Params {
  ring: vec4<f32>,
  camera: vec4<f32>,
  view: vec4<f32>,
  frustum0: vec4<f32>,
  frustum1: vec4<f32>,
  frustum2: vec4<f32>,
  frustum3: vec4<f32>,
  frustum4: vec4<f32>,
  frustum5: vec4<f32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indirect_args: array<u32>;
@group(0) @binding(3) var<storage, read_write> instance_a: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> instance_b: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> source_a: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> source_b: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> asset_meta: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read> asset_lods: array<vec4<f32>>;
@group(0) @binding(9) var<storage, read> group_meta: array<vec4<u32>>;

fn plane_accept(p: vec3<f32>, r: f32, plane: vec4<f32>) -> bool {
  return dot(plane.xyz, p) + plane.w >= -r;
}

fn frustum_accept(p: vec3<f32>, r: f32) -> bool {
  return plane_accept(p, r, params.frustum0)
    && plane_accept(p, r, params.frustum1)
    && plane_accept(p, r, params.frustum2)
    && plane_accept(p, r, params.frustum3)
    && plane_accept(p, r, params.frustum4)
    && plane_accept(p, r, params.frustum5);
}

fn selected_lod(distance_m: f32, lods: vec4<f32>, lod_count: u32) -> u32 {
  var lod = 0u;
  if (lod_count > 1u && distance_m >= lods.y) { lod = 1u; }
  if (lod_count > 2u && distance_m >= lods.z) { lod = 2u; }
  if (lod_count > 3u && distance_m >= lods.w) { lod = 3u; }
  return lod;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn clear_counters(@builtin(global_invocation_id) id: vec3<u32>) {
  let group_count = u32(params.view.z);
  let i = id.x;
  if (i < group_count) {
    atomicStore(&counters[i], 0u);
  }
  if (i < group_count * INDIRECT_STRIDE_U32) {
    indirect_args[i] = 0u;
  }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn cull_props(@builtin(global_invocation_id) id: vec3<u32>) {
  let source_count = u32(params.view.w);
  if (id.x >= source_count) {
    return;
  }

  let src_a = source_a[id.x];
  let src_b = source_b[id.x];
  let pos = src_a.xyz;
  let scale = src_a.w;
  let asset_index = u32(src_b.y);
  let asset = asset_meta[asset_index];
  let max_distance = asset.x;
  let radius = asset.y * scale;
  let lod_count = min(u32(asset.z), LOD_LIMIT);
  let group_base = u32(asset.w);

  let ring_delta = pos.xz - params.ring.xy;
  if (dot(ring_delta, ring_delta) > params.ring.w * params.ring.w) {
    return;
  }

  let cam_delta = pos - params.camera.xyz;
  let distance_m = max(0.001, length(cam_delta) - radius);
  if (distance_m >= max_distance || lod_count == 0u) {
    return;
  }
  if (!frustum_accept(pos, radius)) {
    return;
  }

  let lod = selected_lod(distance_m, asset_lods[asset_index], lod_count);
  let group = group_base + lod;
  let max_instances = u32(params.camera.w);
  let slot = atomicAdd(&counters[group], 1u);
  if (slot >= max_instances) {
    return;
  }

  let out_index = group * max_instances + slot;
  instance_a[out_index] = src_a;
  instance_b[out_index] = vec4<f32>(src_b.x, f32(asset_index), f32(id.x), 0.0);
}

fn write_draw_args(group: u32, index_count: u32, instance_count: u32) {
  let base = group * INDIRECT_STRIDE_U32;
  let max_instances = u32(params.camera.w);
  indirect_args[base + 0u] = index_count;
  indirect_args[base + 1u] = min(instance_count, max_instances);
  indirect_args[base + 2u] = 0u;
  indirect_args[base + 3u] = 0u;
  indirect_args[base + 4u] = group * max_instances;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn build_indirect_args(@builtin(global_invocation_id) id: vec3<u32>) {
  let group_count = u32(params.view.z);
  if (id.x >= group_count) {
    return;
  }
  write_draw_args(id.x, group_meta[id.x].z, atomicLoad(&counters[id.x]));
}
