struct NaadfSpatialResamplingParams {
    enabled: u32,
    radius: u32,
    depth_sigma: f32,
    normal_sigma: f32,
}

@group(3) @binding(10) var<uniform> naadf_spatial_params: NaadfSpatialResamplingParams;
@group(3) @binding(12) var naadf_spatial_source_color: texture_2d<f32>;
@group(3) @binding(13) var naadf_spatial_source_depth: texture_2d<f32>;
@group(3) @binding(14) var naadf_spatial_source_normal: texture_2d<f32>;
@group(3) @binding(15) var naadf_spatial_output: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn naadf_spatial_resampling(@builtin(global_invocation_id) id: vec3<u32>) {
    let output_size = textureDimensions(naadf_spatial_output);
    if any(id.xy >= output_size) {
        return;
    }

    let coord = vec2<i32>(id.xy);
    let max_coord = vec2<i32>(output_size) - vec2<i32>(1);
    let center_sample = textureLoad(naadf_spatial_source_color, coord, 0);
    let center_color = center_sample.xyz;
    let center_depth = textureLoad(naadf_spatial_source_depth, coord, 0).x;
    let center_normal = textureLoad(naadf_spatial_source_normal, coord, 0).xyz * 2.0 - vec3<f32>(1.0);

    if center_sample.a <= 0.0 {
        textureStore(naadf_spatial_output, coord, center_sample);
        return;
    }

    if naadf_spatial_params.enabled == 0u || naadf_spatial_params.radius == 0u {
        textureStore(naadf_spatial_output, coord, center_sample);
        return;
    }

    let radius = i32(naadf_spatial_params.radius);
    var accumulated_color = center_color;
    var accumulated_weight = 1.0;

    for (var y = -radius; y <= radius; y = y + 1) {
        for (var x = -radius; x <= radius; x = x + 1) {
            if x == 0 && y == 0 {
                continue;
            }

            let sample_coord = clamp(coord + vec2<i32>(x, y), vec2<i32>(0), max_coord);
            let sample = textureLoad(naadf_spatial_source_color, sample_coord, 0);
            if sample.a <= 0.0 {
                continue;
            }
            let sample_color = sample.xyz;
            let sample_depth = textureLoad(naadf_spatial_source_depth, sample_coord, 0).x;
            let sample_normal = textureLoad(naadf_spatial_source_normal, sample_coord, 0).xyz * 2.0 - vec3<f32>(1.0);
            let weight = naadf_spatial_weight(
                center_depth,
                sample_depth,
                center_normal,
                sample_normal,
            );
            accumulated_color = accumulated_color + sample_color * weight;
            accumulated_weight = accumulated_weight + weight;
        }
    }

    textureStore(
        naadf_spatial_output,
        coord,
        vec4<f32>(accumulated_color / max(accumulated_weight, 0.0001), center_sample.a),
    );
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
