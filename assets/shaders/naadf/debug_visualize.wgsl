struct NaadfRayStepHeatmapInput {
    steps: u32,
    hit: u32,
    max_steps: u32,
    _pad0: u32,
}

@group(3) @binding(6) var<storage, read> naadf_ray_step_heatmap_inputs: array<NaadfRayStepHeatmapInput>;
@group(3) @binding(7) var<storage, read_write> naadf_ray_step_heatmap_output: array<vec4<f32>>;

@compute @workgroup_size(64)
fn naadf_debug_visualize(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    let input = naadf_ray_step_heatmap_inputs[index];
    naadf_ray_step_heatmap_output[index] = naadf_ray_step_heatmap(
        input.steps,
        max(input.max_steps, 1u),
        input.hit != 0u,
    );
}

fn naadf_ray_step_heatmap(steps: u32, max_steps: u32, hit: bool) -> vec4<f32> {
    let t = clamp(f32(steps) / f32(max_steps), 0.0, 1.0);
    let cheap = vec3<f32>(0.05, 0.85, 0.25);
    let mid = vec3<f32>(1.0, 0.85, 0.1);
    let expensive = vec3<f32>(1.0, 0.1, 0.05);
    let color = select(
        mix(cheap, mid, t * 2.0),
        mix(mid, expensive, (t - 0.5) * 2.0),
        t > 0.5,
    );
    let alpha = select(0.35, 0.85, hit);
    return vec4<f32>(color, alpha);
}
