// Depth-aware fullscreen ambient occlusion pass.

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var depth_texture: texture_depth_2d;

struct GtaoSettings {
    slice_count: u32,
    steps_per_slice: u32,
    radius: f32,
    falloff_range: f32,
    final_value_power: f32,
    sample_distribution_power: f32,
    thin_occluder_compensation: f32,
    _padding: f32,
};

@group(0) @binding(3) var<uniform> settings: GtaoSettings;

const PI: f32 = 3.14159265359;

fn depth_at(uv: vec2<f32>) -> f32 {
    let dims = vec2<i32>(textureDimensions(depth_texture));
    let pixel = clamp(vec2<i32>(uv * vec2<f32>(dims)), vec2<i32>(0), dims - vec2<i32>(1));
    return textureLoad(depth_texture, pixel, 0);
}

fn depth_weight(center_depth: f32) -> f32 {
    return smoothstep(0.001, 0.05, center_depth);
}

fn sample_occlusion(uv: vec2<f32>, center_depth: f32, texel_size: vec2<f32>) -> f32 {
    let slices = min(max(settings.slice_count, 1u), 4u);
    let steps = min(max(settings.steps_per_slice, 1u), 4u);
    let radius_px = max(settings.radius, 0.25) * 4.0;
    let falloff = max(settings.falloff_range, 0.001);

    var occlusion = 0.0;
    var sample_count = 0.0;

    for (var slice: u32 = 0u; slice < slices; slice = slice + 1u) {
        let angle = (f32(slice) / f32(slices)) * PI;
        let dir = vec2<f32>(cos(angle), sin(angle));

        for (var step: u32 = 1u; step <= steps; step = step + 1u) {
            let t = f32(step) / f32(steps);
            let dist_px = pow(t, max(settings.sample_distribution_power, 0.25)) * radius_px;

            for (var side: u32 = 0u; side < 2u; side = side + 1u) {
                let sign = select(-1.0, 1.0, side == 1u);
                let sample_uv = clamp(uv + dir * sign * dist_px * texel_size, vec2<f32>(0.0), vec2<f32>(1.0));
                let sample_depth = depth_at(sample_uv);
                let depth_delta = sample_depth - center_depth;
                let sample_geometry = step(0.001, sample_depth);
                let blocker = smoothstep(0.00005, 0.0035 * falloff, depth_delta) * sample_geometry;
                let distance_fade = 1.0 - t;
                occlusion = occlusion + blocker * distance_fade;
                sample_count = sample_count + 1.0;
            }
        }
    }

    let raw = occlusion / max(sample_count, 1.0);
    let compensated = raw * (1.0 - settings.thin_occluder_compensation);
    return pow(clamp(compensated, 0.0, 1.0), max(settings.final_value_power, 0.25));
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;
    let scene = textureSample(scene_texture, scene_sampler, uv);
    let center_depth = depth_at(uv);

    if center_depth <= 0.001 {
        return vec4<f32>(scene.rgb, 1.0);
    }

    let texel_size = 1.0 / vec2<f32>(textureDimensions(depth_texture));
    let occlusion = sample_occlusion(uv, center_depth, texel_size) * depth_weight(center_depth);
    let ao = clamp(1.0 - occlusion * 0.85, 0.25, 1.0);
    return vec4<f32>(scene.rgb * ao, 1.0);
}
