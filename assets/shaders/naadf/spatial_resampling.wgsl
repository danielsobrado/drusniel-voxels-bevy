struct NaadfSpatialResamplingParams {
    enabled: u32,
    radius: u32,
    depth_sigma: f32,
    normal_sigma: f32,
}

@group(3) @binding(10) var<uniform> naadf_spatial_params: NaadfSpatialResamplingParams;

@compute @workgroup_size(8, 8, 1)
fn naadf_spatial_resampling(@builtin(global_invocation_id) _id: vec3<u32>) {
}

fn naadf_spatial_weight(
    center_depth: f32,
    sample_depth: f32,
    center_normal: vec3<f32>,
    sample_normal: vec3<f32>,
) -> f32 {
    if naadf_spatial_params.enabled == 0u {
        return 0.0;
    }
    let depth_delta = abs(center_depth - sample_depth);
    let normal_delta = max(0.0, 1.0 - dot(normalize(center_normal), normalize(sample_normal)));
    let depth_weight = exp(-depth_delta / max(naadf_spatial_params.depth_sigma, 0.0001));
    let normal_weight = exp(-normal_delta / max(naadf_spatial_params.normal_sigma, 0.0001));
    return depth_weight * normal_weight;
}

fn naadf_spatial_accumulate(
    center_color: vec3<f32>,
    sample_color: vec3<f32>,
    weight: f32,
) -> vec3<f32> {
    return mix(center_color, sample_color, clamp(weight, 0.0, 1.0));
}
