#import "shaders/naadf/ray_trace.wgsl" NaadfRay, trace_naadf
#import "shaders/naadf/world_trace.wgsl" trace_naadf_world

fn naadf_sun_visibility(
    origin: vec3<f32>,
    sun_direction: vec3<f32>,
    max_distance: f32,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> f32 {
    let ray = NaadfRay(
        origin,
        normalize(sun_direction),
        max_distance,
        1u,
    );
    let hit = trace_naadf(
        ray,
        chunk_pos,
        chunk_node,
        voxel_base_record,
        material_base_record,
        max_steps,
    );
    return select(1.0, 0.0, hit.hit != 0u);
}

fn naadf_sun_visibility_bool(
    origin: vec3<f32>,
    sun_direction: vec3<f32>,
    max_distance: f32,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> bool {
    return naadf_sun_visibility(
        origin,
        sun_direction,
        max_distance,
        chunk_pos,
        chunk_node,
        voxel_base_record,
        material_base_record,
        max_steps,
    ) > 0.5;
}

fn naadf_short_range_occlusion(
    origin: vec3<f32>,
    direction: vec3<f32>,
    max_distance: f32,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> f32 {
    let ray = NaadfRay(
        origin,
        normalize(direction),
        max_distance,
        3u,
    );
    let hit = trace_naadf(
        ray,
        chunk_pos,
        chunk_node,
        voxel_base_record,
        material_base_record,
        max_steps,
    );
    return select(0.0, 1.0, hit.hit != 0u);
}

fn naadf_terrain_ao_visibility(
    origin: vec3<f32>,
    direction: vec3<f32>,
    max_distance: f32,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> f32 {
    return 1.0 - naadf_short_range_occlusion(
        origin,
        direction,
        max_distance,
        chunk_pos,
        chunk_node,
        voxel_base_record,
        material_base_record,
        max_steps,
    );
}

fn naadf_contact_shadow_visibility(
    origin: vec3<f32>,
    light_direction: vec3<f32>,
    max_distance: f32,
    chunk_pos: vec3<i32>,
    chunk_node: u32,
    voxel_base_record: u32,
    material_base_record: u32,
    max_steps: u32,
) -> f32 {
    return 1.0 - naadf_short_range_occlusion(
        origin,
        light_direction,
        max_distance,
        chunk_pos,
        chunk_node,
        voxel_base_record,
        material_base_record,
        max_steps,
    );
}

fn naadf_sun_visibility_world(
    origin: vec3<f32>,
    sun_direction: vec3<f32>,
    max_distance: f32,
    max_steps: u32,
    chunk_count: u32,
    chunk_lookup_count: u32,
) -> f32 {
    let ray = NaadfRay(
        origin,
        normalize(sun_direction),
        max_distance,
        1u,
    );
    let hit = trace_naadf_world(ray, max_steps, chunk_count, chunk_lookup_count);
    return select(1.0, 0.0, hit.hit != 0u);
}

fn naadf_short_range_occlusion_world(
    origin: vec3<f32>,
    direction: vec3<f32>,
    max_distance: f32,
    max_steps: u32,
    chunk_count: u32,
    chunk_lookup_count: u32,
) -> f32 {
    let ray = NaadfRay(
        origin,
        normalize(direction),
        max_distance,
        3u,
    );
    let hit = trace_naadf_world(ray, max_steps, chunk_count, chunk_lookup_count);
    return select(0.0, 1.0, hit.hit != 0u);
}

fn naadf_terrain_ao_visibility_world(
    origin: vec3<f32>,
    direction: vec3<f32>,
    max_distance: f32,
    max_steps: u32,
    chunk_count: u32,
    chunk_lookup_count: u32,
) -> f32 {
    return 1.0 - naadf_short_range_occlusion_world(
        origin,
        direction,
        max_distance,
        max_steps,
        chunk_count,
        chunk_lookup_count,
    );
}

fn naadf_contact_shadow_visibility_world(
    origin: vec3<f32>,
    light_direction: vec3<f32>,
    max_distance: f32,
    max_steps: u32,
    chunk_count: u32,
    chunk_lookup_count: u32,
) -> f32 {
    return 1.0 - naadf_short_range_occlusion_world(
        origin,
        light_direction,
        max_distance,
        max_steps,
        chunk_count,
        chunk_lookup_count,
    );
}
