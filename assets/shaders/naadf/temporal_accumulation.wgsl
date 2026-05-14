struct NaadfTemporalAccumulationParams {
    blend_factor: f32,
    reset_history: u32,
    _pad0: vec2<u32>,
}

@group(3) @binding(9) var<uniform> naadf_temporal_params: NaadfTemporalAccumulationParams;

@compute @workgroup_size(8, 8, 1)
fn naadf_temporal_accumulation(@builtin(global_invocation_id) _id: vec3<u32>) {
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
