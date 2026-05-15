struct NaadfPreviewFullscreenCompositeParams {
    mode_split: vec4<f32>,
    pip_min_max: vec4<f32>,
}

@group(0) @binding(0) var naadf_scene_color: texture_2d<f32>;
@group(0) @binding(1) var naadf_preview_color: texture_2d<f32>;
@group(0) @binding(2) var<uniform> naadf_composite_params: NaadfPreviewFullscreenCompositeParams;

@fragment
fn fragment(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let coord = vec2<i32>(position.xy);
    let size = textureDimensions(naadf_preview_color);
    let uv = (position.xy + vec2<f32>(0.5)) / vec2<f32>(size);
    let current_color = textureLoad(naadf_scene_color, coord, 0);
    let preview_color = textureLoad(naadf_preview_color, coord, 0);
    let mode = naadf_composite_params.mode_split.x;
    let split_x = naadf_composite_params.mode_split.y;

    if mode < 0.5 {
        return preview_color;
    }
    if mode < 1.5 {
        return select(current_color, preview_color, uv.x <= split_x);
    }

    let pip_min = naadf_composite_params.pip_min_max.xy;
    let pip_max = naadf_composite_params.pip_min_max.zw;
    let in_pip = all(uv >= pip_min) && all(uv <= pip_max);
    return select(current_color, preview_color, in_pip);
}
