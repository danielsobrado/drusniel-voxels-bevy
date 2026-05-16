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
    let scene_size = textureDimensions(naadf_scene_color);
    let preview_size = textureDimensions(naadf_preview_color);
    let uv = (position.xy + vec2<f32>(0.5)) / vec2<f32>(scene_size);
    let preview_coord = clamp(
        vec2<i32>(uv * vec2<f32>(preview_size)),
        vec2<i32>(0),
        vec2<i32>(preview_size) - vec2<i32>(1),
    );
    let current_color = textureLoad(naadf_scene_color, coord, 0);
    let preview_color = textureLoad(naadf_preview_color, preview_coord, 0);
    let show_miss_sky = naadf_composite_params.mode_split.z > 0.5;
    let preview_alpha = select(
        clamp(preview_color.a, 0.0, 1.0),
        1.0,
        show_miss_sky && preview_color.a <= 0.0,
    );
    let blended_preview = vec4<f32>(
        mix(current_color.rgb, preview_color.rgb, preview_alpha),
        current_color.a,
    );
    let mode = naadf_composite_params.mode_split.x;
    let split_x = naadf_composite_params.mode_split.y;

    if mode < 0.5 {
        return blended_preview;
    }
    if mode < 1.5 {
        return select(current_color, blended_preview, uv.x <= split_x);
    }

    let pip_min = naadf_composite_params.pip_min_max.xy;
    let pip_max = naadf_composite_params.pip_min_max.zw;
    let in_pip = all(uv >= pip_min) && all(uv <= pip_max);
    return select(current_color, blended_preview, in_pip);
}
