#import "shaders/naadf/ray_trace.wgsl" NaadfHit, NaadfRay, trace_naadf_dense_debug

fn trace_naadf_gi_from_records(
    ray: NaadfRay,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> NaadfHit {
    return trace_naadf_dense_debug(
        ray,
        chunk_pos,
        chunk_node,
        voxel_base_record,
        material_base_record,
        max_steps,
    );
}
