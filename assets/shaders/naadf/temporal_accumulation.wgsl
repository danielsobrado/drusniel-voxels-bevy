struct NaadfTemporalAccumulationParams {
    blend_factor: f32,
    reset_history: u32,
    _pad0: vec2<u32>,
    camera_origin_max_distance: vec4<f32>,
    camera_forward_fov_y: vec4<f32>,
    camera_right_aspect: vec4<f32>,
    camera_up_pad: vec4<f32>,
}

@group(3) @binding(9) var<uniform> naadf_temporal_params: NaadfTemporalAccumulationParams;
@group(3) @binding(12) var naadf_temporal_current_color: texture_2d<f32>;
@group(3) @binding(13) var naadf_temporal_history_color: texture_2d<f32>;
@group(3) @binding(14) var naadf_temporal_current_depth: texture_2d<f32>;
@group(3) @binding(15) var naadf_temporal_output: texture_storage_2d<rgba16float, write>;
@group(3) @binding(16) var naadf_temporal_history_moments: texture_2d<f32>;
@group(3) @binding(17) var naadf_temporal_output_moments: texture_storage_2d<rg16float, write>;
@group(3) @binding(18) var naadf_temporal_motion: texture_2d<f32>;
@group(3) @binding(19) var naadf_temporal_current_owner: texture_2d<u32>;
@group(3) @binding(20) var naadf_temporal_history_owner: texture_2d<u32>;
@group(3) @binding(21) var naadf_temporal_output_owner: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(8, 8, 1)
fn naadf_temporal_accumulation(@builtin(global_invocation_id) id: vec3<u32>) {
    let output_size = textureDimensions(naadf_temporal_output);
    if any(id.xy >= output_size) {
        return;
    }

    let coord = vec2<i32>(id.xy);
    let current_color = textureLoad(naadf_temporal_current_color, coord, 0);
    let depth = textureLoad(naadf_temporal_current_depth, coord, 0).x;
    let motion = textureLoad(naadf_temporal_motion, coord, 0);
    let reprojection = naadf_reproject_history_coord(coord, output_size, depth, current_color.a, motion);
    let history_coord = reprojection.xy;
    let current_owner = textureLoad(naadf_temporal_current_owner, coord, 0).r;
    let history_owner = textureLoad(naadf_temporal_history_owner, history_coord, 0).r;
    let history_color = textureLoad(naadf_temporal_history_color, history_coord, 0);
    let history_moments = textureLoad(naadf_temporal_history_moments, history_coord, 0).xy;
    let motion_valid = reprojection.z != 0i &&
        current_owner == 1u &&
        history_owner == current_owner;
    let accumulated_color = naadf_temporal_accumulate(
        current_color,
        history_color,
        history_moments,
        motion_valid,
    );
    let accumulated_moments = naadf_temporal_accumulate_moments(
        current_color,
        history_moments,
        motion_valid,
    );

    textureStore(naadf_temporal_output, coord, accumulated_color);
    textureStore(naadf_temporal_output_moments, coord, accumulated_moments);
    textureStore(naadf_temporal_output_owner, coord, vec4<u32>(current_owner, 0u, 0u, 0u));
}

fn naadf_reproject_history_coord(
    coord: vec2<i32>,
    output_size: vec2<u32>,
    depth: f32,
    alpha: f32,
    motion: vec4<f32>,
) -> vec3<i32> {
    if naadf_temporal_params.reset_history != 0u || alpha <= 0.0 || motion.z <= 0.0 {
        return vec3<i32>(coord, 0i);
    }

    let size_f = vec2<f32>(output_size);
    let uv = (vec2<f32>(coord) + vec2<f32>(0.5)) / size_f;
    let previous_uv = uv - motion.xy;
    if any(previous_uv < vec2<f32>(0.0)) || any(previous_uv > vec2<f32>(1.0)) {
        return vec3<i32>(coord, 0i);
    }

    let max_coord = vec2<i32>(output_size) - vec2<i32>(1);
    let previous_coord = clamp(vec2<i32>(previous_uv * size_f), vec2<i32>(0), max_coord);
    return vec3<i32>(previous_coord, 1i);
}

fn naadf_temporal_accumulate(
    current_color: vec4<f32>,
    history_color: vec4<f32>,
    history_moments: vec2<f32>,
    motion_valid: bool,
) -> vec4<f32> {
    if naadf_temporal_params.reset_history != 0u || !motion_valid {
        return current_color;
    }
    if current_color.a <= 0.0 || history_color.a <= 0.0 {
        return current_color;
    }
    if !naadf_history_luminance_matches_current(current_color, history_moments) {
        return current_color;
    }
    return mix(current_color, history_color, clamp(naadf_temporal_params.blend_factor, 0.0, 0.99));
}

fn naadf_history_luminance_matches_current(
    current_color: vec4<f32>,
    history_moments: vec2<f32>,
) -> bool {
    let current_luminance = dot(current_color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let history_mean = history_moments.x;
    let history_variance = max(0.0, history_moments.y - history_mean * history_mean);
    let sigma = sqrt(history_variance + 0.0004);
    return abs(current_luminance - history_mean) <= sigma * 3.0;
}

fn naadf_temporal_accumulate_moments(
    current_color: vec4<f32>,
    history_moments: vec2<f32>,
    motion_valid: bool,
) -> vec4<f32> {
    let luminance = dot(current_color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let current_moments = vec2<f32>(luminance, luminance * luminance);
    if naadf_temporal_params.reset_history != 0u || !motion_valid {
        return vec4<f32>(current_moments.x, current_moments.y, 0.0, 1.0);
    }

    let blend = clamp(naadf_temporal_params.blend_factor, 0.0, 0.99);
    let moments = mix(current_moments, history_moments, blend);
    let variance = max(0.0, moments.y - moments.x * moments.x);
    return vec4<f32>(moments.x, moments.y, variance, 1.0);
}
