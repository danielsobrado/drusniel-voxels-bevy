#import "shaders/naadf/lighting_queries.wgsl" naadf_sun_visibility_world

struct NaadfFroxelSunMaskParams {
    grid: vec4<u32>,
    volume_min_max_distance: vec4<f32>,
    volume_size_pad: vec4<f32>,
    sun_direction_pad: vec4<f32>,
    config: vec4<u32>,
}

@group(3) @binding(40) var<uniform> naadf_froxel_sun_mask_params: NaadfFroxelSunMaskParams;
@group(3) @binding(41) var<storage, read_write> naadf_froxel_sun_mask: array<u32>;

@compute @workgroup_size(4, 4, 4)
fn build_naadf_froxel_sun_mask(@builtin(global_invocation_id) id: vec3<u32>) {
    let grid = naadf_froxel_sun_mask_params.grid.xyz;
    if any(id >= grid) {
        return;
    }

    let index = id.x + id.y * grid.x + id.z * grid.x * grid.y;
    let center = (vec3<f32>(id) + vec3<f32>(0.5)) / vec3<f32>(grid);
    let origin =
        naadf_froxel_sun_mask_params.volume_min_max_distance.xyz +
        center * naadf_froxel_sun_mask_params.volume_size_pad.xyz;
    let visibility = naadf_sun_visibility_world(
        origin,
        normalize(naadf_froxel_sun_mask_params.sun_direction_pad.xyz),
        naadf_froxel_sun_mask_params.volume_min_max_distance.w,
        naadf_froxel_sun_mask_params.config.x,
        naadf_froxel_sun_mask_params.config.y,
        naadf_froxel_sun_mask_params.config.z,
    );
    naadf_froxel_sun_mask[index] = select(0u, 1u, visibility > 0.5);
}
