const NAADF_PREVIEW_FULLSCREEN: u32 = 0u;
const NAADF_PREVIEW_SPLIT_VIEW: u32 = 1u;
const NAADF_PREVIEW_PICTURE_IN_PICTURE: u32 = 2u;

struct NaadfPreviewCompositeParams {
    mode: u32,
    split_x: f32,
    pip_min: vec2<f32>,
    pip_max: vec2<f32>,
}

@group(3) @binding(8) var<uniform> naadf_preview_composite_params: NaadfPreviewCompositeParams;

@compute @workgroup_size(8, 8, 1)
fn naadf_preview_composite(@builtin(global_invocation_id) _id: vec3<u32>) {
}

fn naadf_preview_composite_color(
    uv: vec2<f32>,
    current_color: vec4<f32>,
    preview_color: vec4<f32>,
) -> vec4<f32> {
    if naadf_preview_composite_params.mode == NAADF_PREVIEW_FULLSCREEN {
        return preview_color;
    }
    if naadf_preview_composite_params.mode == NAADF_PREVIEW_SPLIT_VIEW {
        return select(current_color, preview_color, uv.x <= naadf_preview_composite_params.split_x);
    }
    let in_pip = all(uv >= naadf_preview_composite_params.pip_min) &&
        all(uv <= naadf_preview_composite_params.pip_max);
    return select(current_color, preview_color, in_pip);
}
