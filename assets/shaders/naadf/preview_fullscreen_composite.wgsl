struct NaadfPreviewFullscreenCompositeParams {
    mode_split: vec4<f32>,
    pip_min_max: vec4<f32>,
    path_b_config: vec4<f32>,
    view_from_clip: mat4x4<f32>,
}

@group(0) @binding(0) var naadf_scene_color: texture_2d<f32>;
@group(0) @binding(1) var naadf_preview_color: texture_2d<f32>;
@group(0) @binding(2) var<uniform> naadf_composite_params: NaadfPreviewFullscreenCompositeParams;
@group(0) @binding(3) var naadf_scene_depth: texture_depth_2d;
@group(0) @binding(4) var naadf_foreground_coverage: texture_2d<f32>;
@group(0) @binding(5) var naadf_preview_depth: texture_2d<f32>;

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
    let depth_size = textureDimensions(naadf_scene_depth);
    let depth_coord = clamp(coord, vec2<i32>(0), vec2<i32>(depth_size) - vec2<i32>(1));
    let scene_depth = textureLoad(naadf_scene_depth, depth_coord, 0);
    let coverage_size = textureDimensions(naadf_foreground_coverage);
    let coverage_coord = clamp(coord, vec2<i32>(0), vec2<i32>(coverage_size) - vec2<i32>(1));
    let foreground_coverage = textureLoad(naadf_foreground_coverage, coverage_coord, 0).r;
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

    if mode >= 3.5 {
        return naadf_depth_audit_color(
            current_color,
            preview_color,
            scene_depth,
            foreground_coverage,
            uv,
            preview_coord,
        );
    }
    if mode >= 2.5 {
        return naadf_hybrid_far_terrain_color(
            current_color,
            preview_color,
            scene_depth,
            foreground_coverage,
            uv,
            preview_coord,
        );
    }

    if mode < 0.5 {
        // Fullscreen is pure NAADF: the preview texture already carries a
        // miss-sky colour in RGB, so return it directly without scene blending.
        return vec4<f32>(preview_color.rgb, current_color.a);
    }
    if mode < 1.5 {
        let divider_width = max(0.001, 1.5 / f32(scene_size.x));
        if abs(uv.x - split_x) <= divider_width {
            return vec4<f32>(1.0, 0.92, 0.12, current_color.a);
        }
        return select(current_color, blended_preview, uv.x <= split_x);
    }

    let pip_min = naadf_composite_params.pip_min_max.xy;
    let pip_max = naadf_composite_params.pip_min_max.zw;
    let in_pip = all(uv >= pip_min) && all(uv <= pip_max);
    return select(current_color, blended_preview, in_pip);
}

fn naadf_hybrid_far_terrain_color(
    current_color: vec4<f32>,
    preview_color: vec4<f32>,
    scene_depth: f32,
    foreground_coverage: f32,
    uv: vec2<f32>,
    preview_coord: vec2<i32>,
) -> vec4<f32> {
    if preview_color.a <= 0.0 {
        return current_color;
    }
    if naadf_foreground_coverage_valid() && foreground_coverage > 0.001 {
        return current_color;
    }
    let raster_linear_depth = naadf_reconstruct_linear_view_depth(uv, scene_depth);
    let naadf_linear_depth = textureLoad(naadf_preview_depth, preview_coord, 0).r;
    if naadf_scene_depth_valid(scene_depth) &&
        raster_linear_depth <= naadf_linear_depth + naadf_composite_params.path_b_config.x {
        return current_color;
    }
    return vec4<f32>(preview_color.rgb, current_color.a);
}

fn naadf_depth_audit_color(
    current_color: vec4<f32>,
    preview_color: vec4<f32>,
    scene_depth: f32,
    foreground_coverage: f32,
    uv: vec2<f32>,
    preview_coord: vec2<i32>,
) -> vec4<f32> {
    let alpha = naadf_composite_params.path_b_config.y;
    var audit = vec3<f32>(0.15, 0.15, 0.18);
    if preview_color.a <= 0.0 {
        audit = vec3<f32>(0.1, 0.2, 0.8);
    } else if naadf_foreground_coverage_valid() && foreground_coverage > 0.001 {
        audit = vec3<f32>(1.0, 0.75, 0.1);
    } else {
        let raster_linear_depth = naadf_reconstruct_linear_view_depth(uv, scene_depth);
        let naadf_linear_depth = textureLoad(naadf_preview_depth, preview_coord, 0).r;
        if naadf_scene_depth_valid(scene_depth) &&
            raster_linear_depth <= naadf_linear_depth + naadf_composite_params.path_b_config.x {
            audit = vec3<f32>(1.0, 0.15, 0.15);
        } else {
            audit = vec3<f32>(0.1, 0.85, 0.35);
        }
    }
    return vec4<f32>(mix(current_color.rgb, audit, alpha), current_color.a);
}

fn naadf_scene_depth_valid(depth: f32) -> bool {
    return naadf_composite_params.path_b_config.z > 0.5 && depth > 0.001;
}

fn naadf_foreground_coverage_valid() -> bool {
    return naadf_composite_params.path_b_config.w > 0.5;
}

fn naadf_reconstruct_linear_view_depth(uv: vec2<f32>, depth: f32) -> f32 {
    if !naadf_scene_depth_valid(depth) {
        return 1000000.0;
    }
    let ndc = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), depth, 1.0);
    let view = naadf_composite_params.view_from_clip * ndc;
    let view_pos = view.xyz / max(view.w, 0.000001);
    return max(-view_pos.z, 0.0);
}
