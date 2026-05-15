struct NaadfTemporalAccumulationParams {
    blend_factor: f32,
    reset_history: u32,
    _pad0: vec2<u32>,
}

@group(3) @binding(9) var<uniform> naadf_temporal_params: NaadfTemporalAccumulationParams;
@group(3) @binding(12) var naadf_temporal_current_color: texture_2d<f32>;
@group(3) @binding(13) var naadf_temporal_history_color: texture_2d<f32>;
@group(3) @binding(14) var naadf_temporal_motion_valid: texture_2d<f32>;
@group(3) @binding(15) var naadf_temporal_output: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn naadf_temporal_accumulation(@builtin(global_invocation_id) id: vec3<u32>) {
    let output_size = textureDimensions(naadf_temporal_output);
    if any(id.xy >= output_size) {
        return;
    }

    let coord = vec2<i32>(id.xy);
    let current_color = textureLoad(naadf_temporal_current_color, coord, 0);
    let history_color = textureLoad(naadf_temporal_history_color, coord, 0);
    let motion_valid = textureLoad(naadf_temporal_motion_valid, coord, 0).w > 0.5;
    textureStore(
        naadf_temporal_output,
        coord,
        naadf_temporal_accumulate(current_color, history_color, motion_valid),
    );
}

fn naadf_temporal_accumulate(
    current_color: vec4<f32>,
    history_color: vec4<f32>,
    motion_valid: bool,
) -> vec4<f32> {
    if naadf_temporal_params.reset_history != 0u || !motion_valid {
        return current_color;
    }
    return mix(current_color, history_color, clamp(naadf_temporal_params.blend_factor, 0.0, 0.99));
}
