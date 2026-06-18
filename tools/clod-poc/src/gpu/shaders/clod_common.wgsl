struct ClodNodeGpu {
    center_radius: vec4<f32>,
    error_level_reserved: vec4<f32>,
};

fn clod_error_px(error_world: f32, viewport_h: f32, distance: f32, fov_y: f32) -> f32 {
    return (error_world * viewport_h) / (2.0 * max(distance, 0.001) * tan(fov_y * 0.5));
}

fn clod_node_error_px(node: ClodNodeGpu, cam_pos: vec3<f32>, viewport_h: f32, fov_y: f32) -> f32 {
    let center = node.center_radius.xyz;
    let radius = node.center_radius.w;
    let distance = max(0.001, length(cam_pos - center) - radius);
    return clod_error_px(node.error_level_reserved.x, viewport_h, distance, fov_y);
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
