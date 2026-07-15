struct ClodNodeGpu {
    center_radius: vec4<f32>,       // [0-3] center.xyz, radius
    error_level_min_y: vec4<f32>,   // [4-7] errorWorld, level, minY, maxY
    page_span_reserved: vec4<f32>,  // [8-11] pageSpan, reserved, reserved, reserved
};

fn clod_error_px(error_world: f32, viewport_h: f32, distance: f32, fov_y: f32) -> f32 {
    return (error_world * viewport_h) / (2.0 * max(distance, 0.001) * tan(fov_y * 0.5));
}

// LV-1: relief bias — nodes with more vertical extent split earlier, matching the CPU path
// in selection.ts errorPx().  The boost is applied to screen-space error only (errorWorld
// stays monotonic for the DAG-cut invariant).  Relief bias from height-range / page-span ratio.
fn clod_relief_boost(min_y: f32, max_y: f32, page_span: f32) -> f32 {
    if (page_span <= 0.0) { return 1.0; }
    let height_range = max_y - min_y;
    return clamp(1.0 + (height_range / page_span) * 0.8, 1.0, 1.8);
}

fn clod_node_error_px(node: ClodNodeGpu, cam_pos: vec3<f32>, viewport_h: f32, fov_y: f32) -> f32 {
    let center = node.center_radius.xyz;
    let radius = node.center_radius.w;
    let distance = max(0.001, length(cam_pos - center) - radius);
    let base = clod_error_px(node.error_level_min_y.x, viewport_h, distance, fov_y);
    // minY is at error_level_min_y.z, maxY is at error_level_min_y.w, pageSpan is at page_span_reserved.x
    let boost = clod_relief_boost(node.error_level_min_y.z, node.error_level_min_y.w, node.page_span_reserved.x);
    return base * boost;
}

fn clod_debug_lod_color(level: u32) -> vec4<f32> {
    if (level == 0u) {
        return vec4<f32>(0.6118, 0.6392, 0.6784, 1.0);
    }
    if (level == 1u) {
        return vec4<f32>(0.2275, 0.4314, 0.6471, 1.0);
    }
    if (level == 2u) {
        return vec4<f32>(0.2863, 0.6275, 0.4706, 1.0);
    }
    return vec4<f32>(0.8510, 0.5020, 0.1961, 1.0);
}
