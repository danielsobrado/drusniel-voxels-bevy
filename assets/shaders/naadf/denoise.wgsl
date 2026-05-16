struct NaadfDenoiseParams {
    enabled: u32,
    radius: u32,
    depth_sigma: f32,
    normal_sigma: f32,
}

@group(3) @binding(23) var<uniform> naadf_denoise_params: NaadfDenoiseParams;
@group(3) @binding(24) var naadf_denoise_source_color: texture_2d<f32>;
@group(3) @binding(25) var naadf_denoise_source_depth: texture_2d<f32>;
@group(3) @binding(26) var naadf_denoise_source_normal: texture_2d<f32>;
@group(3) @binding(27) var naadf_denoise_output: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn naadf_denoise(@builtin(global_invocation_id) id: vec3<u32>) {
    let output_size = textureDimensions(naadf_denoise_output);
    if any(id.xy >= output_size) {
        return;
    }

    let coord = vec2<i32>(id.xy);
    let max_coord = vec2<i32>(output_size) - vec2<i32>(1);
    let center = textureLoad(naadf_denoise_source_color, coord, 0);
    if center.a <= 0.0 {
        textureStore(naadf_denoise_output, coord, center);
        return;
    }
    if naadf_denoise_params.enabled == 0u || naadf_denoise_params.radius == 0u {
        textureStore(naadf_denoise_output, coord, center);
        return;
    }

    let center_depth = textureLoad(naadf_denoise_source_depth, coord, 0).x;
    let center_normal = textureLoad(naadf_denoise_source_normal, coord, 0).xyz * 2.0 - vec3<f32>(1.0);
    let radius = i32(naadf_denoise_params.radius);
    var accumulated_color = center.xyz;
    var accumulated_weight = 1.0;

    for (var y = -radius; y <= radius; y = y + 1) {
        for (var x = -radius; x <= radius; x = x + 1) {
            if x == 0 && y == 0 {
                continue;
            }

            let sample_coord = clamp(coord + vec2<i32>(x, y), vec2<i32>(0), max_coord);
            let sample = textureLoad(naadf_denoise_source_color, sample_coord, 0);
            if sample.a <= 0.0 {
                continue;
            }

            let sample_depth = textureLoad(naadf_denoise_source_depth, sample_coord, 0).x;
            let sample_normal = textureLoad(naadf_denoise_source_normal, sample_coord, 0).xyz * 2.0 - vec3<f32>(1.0);
            let pixel_distance = length(vec2<f32>(f32(x), f32(y)));
            let weight = naadf_denoise_weight(
                center_depth,
                sample_depth,
                center_normal,
                sample_normal,
                pixel_distance,
            );
            accumulated_color = accumulated_color + sample.xyz * weight;
            accumulated_weight = accumulated_weight + weight;
        }
    }

    textureStore(
        naadf_denoise_output,
        coord,
        vec4<f32>(accumulated_color / max(accumulated_weight, 0.0001), center.a),
    );
}

fn naadf_denoise_weight(
    center_depth: f32,
    sample_depth: f32,
    center_normal: vec3<f32>,
    sample_normal: vec3<f32>,
    pixel_distance: f32,
) -> f32 {
    let depth_delta = abs(center_depth - sample_depth);
    let normal_delta = max(0.0, 1.0 - dot(normalize(center_normal), normalize(sample_normal)));
    let depth_weight = exp(-depth_delta / max(naadf_denoise_params.depth_sigma, 0.0001));
    let normal_weight = exp(-normal_delta / max(naadf_denoise_params.normal_sigma, 0.0001));
    let spatial_weight = exp(-pixel_distance * 0.35);
    return depth_weight * normal_weight * spatial_weight;
}
