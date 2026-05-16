#import "shaders/naadf/ray_trace.wgsl" NaadfRay, NaadfHit, trace_naadf

struct NaadfDebugRayInput {
    origin_max_distance: vec4<f32>,
    direction_purpose: vec4<f32>,
    chunk_pos: vec4<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
}

struct NaadfDebugRayOutput {
    hit_distance_material_steps: vec4<u32>,
    world_voxel: vec4<i32>,
    local_voxel: vec4<u32>,
    normal: vec4<f32>,
}

struct NaadfDebugTraceParams {
    ray_count: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(3) @binding(2) var<storage, read> naadf_debug_ray_inputs: array<NaadfDebugRayInput>;
@group(3) @binding(3) var<storage, read_write> naadf_debug_ray_outputs: array<NaadfDebugRayOutput>;
@group(3) @binding(4) var<uniform> naadf_debug_trace_params: NaadfDebugTraceParams;

@compute @workgroup_size(64)
fn debug_trace_rays(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    if index >= naadf_debug_trace_params.ray_count {
        return;
    }

    let input = naadf_debug_ray_inputs[index];
    let ray = NaadfRay(
        input.origin_max_distance.xyz,
        input.direction_purpose.xyz,
        input.origin_max_distance.w,
        u32(input.direction_purpose.w),
    );
    let hit = trace_naadf(
        ray,
        input.chunk_pos.xyz,
        input.chunk_node,
        input.voxel_base_record,
        input.material_base_record,
        input.max_steps,
    );

    naadf_debug_ray_outputs[index] = NaadfDebugRayOutput(
        vec4<u32>(hit.hit, bitcast<u32>(hit.distance), hit.material_id, hit.steps),
        vec4<i32>(hit.world_voxel, 0),
        vec4<u32>(hit.local_voxel, 0u),
        vec4<f32>(hit.normal, 0.0),
    );
}
