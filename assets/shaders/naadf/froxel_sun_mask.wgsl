#import "shaders/naadf/lighting_queries.wgsl" naadf_sun_visibility_world

struct NaadfFroxelSunMaskParams {
    grid: vec4<u32>,
    camera_origin_max_distance: vec4<f32>,
    camera_forward_fov_y: vec4<f32>,
    camera_right_aspect: vec4<f32>,
    camera_up_pad: vec4<f32>,
    sun_direction_pad: vec4<f32>,
    config: vec4<u32>,
}

@group(3) @binding(40) var<uniform> naadf_froxel_sun_mask_params: NaadfFroxelSunMaskParams;
@group(3) @binding(41) var<storage, read_write> naadf_froxel_sun_mask: array<u32>;

@compute @workgroup_size(64, 1, 1)
fn build_naadf_froxel_sun_mask(@builtin(global_invocation_id) id: vec3<u32>) {
    let grid = naadf_froxel_sun_mask_params.grid.xyz;
    let total = grid.x * grid.y * grid.z;
    if total == 0u || naadf_froxel_sun_mask_params.grid.w == 0u {
        return;
    }

    let index = id.x + naadf_froxel_sun_mask_params.config.w;
    if index >= total {
        return;
    }

    let z = index / (grid.x * grid.y);
    let y = (index - z * grid.x * grid.y) / grid.x;
    let x = index - z * grid.x * grid.y - y * grid.x;
    let uv = (vec2<f32>(f32(x), f32(y)) + vec2<f32>(0.5)) / vec2<f32>(grid.xy);
    let ndc = uv * 2.0 - vec2<f32>(1.0);
    let fov_scale = tan(naadf_froxel_sun_mask_params.camera_forward_fov_y.w * 0.5);
    let view_ray = normalize(
        naadf_froxel_sun_mask_params.camera_forward_fov_y.xyz +
        naadf_froxel_sun_mask_params.camera_right_aspect.xyz *
            (ndc.x * naadf_froxel_sun_mask_params.camera_right_aspect.w * fov_scale) +
        naadf_froxel_sun_mask_params.camera_up_pad.xyz * (-ndc.y * fov_scale),
    );
    let depth_fraction = (f32(z) + 0.5) / f32(grid.z);
    let origin = naadf_froxel_sun_mask_params.camera_origin_max_distance.xyz +
        view_ray * (depth_fraction * naadf_froxel_sun_mask_params.camera_origin_max_distance.w);
    let visibility = naadf_sun_visibility_world(
        origin,
        normalize(naadf_froxel_sun_mask_params.sun_direction_pad.xyz),
        naadf_froxel_sun_mask_params.camera_origin_max_distance.w,
        naadf_froxel_sun_mask_params.config.x,
        naadf_froxel_sun_mask_params.config.y,
        naadf_froxel_sun_mask_params.config.z,
    );
    naadf_froxel_sun_mask[index] = select(0u, 1u, visibility > 0.5);
}
