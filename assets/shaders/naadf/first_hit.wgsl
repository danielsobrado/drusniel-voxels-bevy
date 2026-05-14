#import "shaders/naadf/ray_trace.wgsl" NaadfHit, NaadfRay, trace_naadf_dense_debug

struct NaadfFirstHitPreview {
    hit: u32,
    color: vec3<f32>,
    distance: f32,
    normal: vec3<f32>,
    material_id: u32,
}

fn trace_naadf_first_hit(
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

fn preview_naadf_first_hit(
    ray: NaadfRay,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> NaadfFirstHitPreview {
    let hit = trace_naadf_first_hit(
        ray,
        chunk_pos,
        chunk_node,
        voxel_base_record,
        material_base_record,
        max_steps,
    );
    return NaadfFirstHitPreview(
        hit.hit,
        naadf_preview_material_color(hit.material_id),
        hit.distance,
        hit.normal,
        hit.material_id,
    );
}

fn naadf_preview_material_color(material_id: u32) -> vec3<f32> {
    if material_id == 0u {
        return vec3<f32>(0.55, 0.72, 0.95);
    }
    if material_id == 2u {
        return vec3<f32>(0.42, 0.38, 0.32);
    }
    if material_id == 3u {
        return vec3<f32>(0.18, 0.28, 0.95);
    }
    return vec3<f32>(0.48, 0.58, 0.34);
}
