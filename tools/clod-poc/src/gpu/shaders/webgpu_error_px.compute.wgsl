struct ClodErrorParams {
    cam_pos_viewport_h: vec4<f32>,
    fov_y_node_count: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> clod_nodes: array<ClodNodeGpu>;
@group(0) @binding(1) var<uniform> clod_params: ClodErrorParams;
@group(0) @binding(2) var<storage, read_write> clod_error_px_out: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn compute_clod_error_px(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let node_count = u32(clod_params.fov_y_node_count.y);
    if (index >= node_count) {
        return;
    }

    clod_error_px_out[index] = clod_node_error_px(
        clod_nodes[index],
        clod_params.cam_pos_viewport_h.xyz,
        clod_params.cam_pos_viewport_h.w,
        clod_params.fov_y_node_count.x,
    );
}
