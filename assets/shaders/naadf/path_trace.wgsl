struct NaadfPathTraceParams {
    enabled: u32,
    sample_count: u32,
    sky_strength: f32,
    indirect_strength: f32,
}

@group(3) @binding(33) var<uniform> naadf_path_trace_params: NaadfPathTraceParams;
@group(3) @binding(34) var naadf_path_trace_source_color: texture_2d<f32>;
@group(3) @binding(35) var naadf_path_trace_first_hit_color: texture_2d<f32>;
@group(3) @binding(36) var naadf_path_trace_first_hit_depth: texture_2d<f32>;
@group(3) @binding(37) var naadf_path_trace_first_hit_normal: texture_2d<f32>;
@group(3) @binding(38) var naadf_path_trace_output: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn naadf_path_trace_reference(@builtin(global_invocation_id) id: vec3<u32>) {
    let output_size = textureDimensions(naadf_path_trace_output);
    if any(id.xy >= output_size) {
        return;
    }

    let coord = vec2<i32>(id.xy);
    let source = textureLoad(naadf_path_trace_source_color, coord, 0);
    if source.a <= 0.0 || naadf_path_trace_params.enabled == 0u {
        textureStore(naadf_path_trace_output, coord, source);
        return;
    }

    let depth = textureLoad(naadf_path_trace_first_hit_depth, coord, 0).x;
    let normal = normalize(textureLoad(naadf_path_trace_first_hit_normal, coord, 0).xyz * 2.0 - vec3<f32>(1.0));
    let reference = naadf_reference_indirect(coord, output_size, depth, normal);
    let sky = vec3<f32>(0.50, 0.60, 0.76) * clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
    let color = source.xyz +
        reference * naadf_path_trace_params.indirect_strength +
        sky * naadf_path_trace_params.sky_strength * (1.0 - depth * 0.35);
    textureStore(naadf_path_trace_output, coord, vec4<f32>(color, source.a));
}

fn naadf_reference_indirect(
    coord: vec2<i32>,
    output_size: vec2<u32>,
    center_depth: f32,
    center_normal: vec3<f32>,
) -> vec3<f32> {
    let max_coord = vec2<i32>(output_size) - vec2<i32>(1);
    let samples = min(max(naadf_path_trace_params.sample_count, 1u), 32u);
    var accumulated = vec3<f32>(0.0);
    var accumulated_weight = 0.0;

    for (var i = 0u; i < samples; i = i + 1u) {
        let offset = naadf_reference_sample_offset(i, coord);
        let sample_coord = clamp(coord + offset, vec2<i32>(0), max_coord);
        let sample = textureLoad(naadf_path_trace_first_hit_color, sample_coord, 0);
        if sample.a <= 0.0 {
            continue;
        }
        let sample_depth = textureLoad(naadf_path_trace_first_hit_depth, sample_coord, 0).x;
        let sample_normal = normalize(textureLoad(naadf_path_trace_first_hit_normal, sample_coord, 0).xyz * 2.0 - vec3<f32>(1.0));
        let depth_weight = exp(-abs(center_depth - sample_depth) / 0.08);
        let facing_weight = clamp(dot(center_normal, sample_normal) * 0.5 + 0.5, 0.0, 1.0);
        let distance_weight = exp(-length(vec2<f32>(offset)) * 0.075);
        let bounce_tint = mix(sample.xyz, sample.xyz * sample.xyz, 0.35);
        let weight = depth_weight * facing_weight * distance_weight;
        accumulated = accumulated + bounce_tint * weight;
        accumulated_weight = accumulated_weight + weight;
    }

    return accumulated / max(accumulated_weight, 0.0001);
}

fn naadf_reference_sample_offset(index: u32, coord: vec2<i32>) -> vec2<i32> {
    let golden_angle = 2.3999632;
    let jitter = naadf_reference_hash(vec2<u32>(coord)) * 6.2831853;
    let radius = sqrt(f32(index) + 0.5) * 2.25;
    let angle = f32(index) * golden_angle + jitter;
    let offset = vec2<f32>(cos(angle), sin(angle)) * radius;
    let rounded = vec2<i32>(round(offset));
    if all(rounded == vec2<i32>(0)) {
        return vec2<i32>(1, 0);
    }
    return rounded;
}

fn naadf_reference_hash(value: vec2<u32>) -> f32 {
    var state = value.x * 1664525u + value.y * 1013904223u + 747796405u;
    state = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    state = (state >> 22u) ^ state;
    return f32(state & 0x00ffffffu) / f32(0x01000000u);
}
