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
@group(3) @binding(12) var naadf_composite_current_color: texture_2d<f32>;
@group(3) @binding(13) var naadf_composite_preview_color: texture_2d<f32>;
@group(3) @binding(14) var naadf_composite_output: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn naadf_preview_composite(@builtin(global_invocation_id) id: vec3<u32>) {
    let output_size = textureDimensions(naadf_composite_output);
    if any(id.xy >= output_size) {
        return;
    }

    let coord = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(output_size);
    let current_color = textureLoad(naadf_composite_current_color, coord, 0);
    let preview_color = textureLoad(naadf_composite_preview_color, coord, 0);
    textureStore(
        naadf_composite_output,
        coord,
        naadf_preview_composite_color(uv, current_color, preview_color),
    );
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
