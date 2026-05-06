// Shader-pack style weather helpers.
//
// This module is intentionally uniform/noise based. It does not require weather textures,
// storage buffers, CPU-generated maps, or expensive multi-octave noise.

#define_import_path weather_common

const WEATHER_KIND_CLEAR: u32 = 0u;
const WEATHER_KIND_RAIN: u32 = 1u;
const WEATHER_KIND_SNOW: u32 = 2u;
const WEATHER_FLAG_PUDDLE_DETAIL: u32 = 4u;
const WEATHER_FLAG_INTEGRATED_FALLBACK: u32 = 16u;

const WEATHER_TEX_OPACITY: f32 = 0.72;
const RAIN_PUDDLES: f32 = 1.0;

fn square(x: f32) -> f32 {
    return x * x;
}

// Cheap monotonic sqrt-like curve for 0..1 weather masks.
fn sqrt_curve_light(x: f32) -> f32 {
    let s = safe_saturate(x);
    return 1.0 - square(1.0 - s);
}

// Stronger sqrt-like curve used for softer accumulation masks.
fn sqrt_curve_soft(x: f32) -> f32 {
    let s = safe_saturate(x);
    let inv = 1.0 - s;
    return 1.0 - square(square(inv));
}

fn max_zero(x: f32) -> f32 {
    return max(x, 0.0);
}

fn safe_saturate(x: f32) -> f32 {
    return clamp(x, 0.0, 1.0);
}

fn weather_opacity_remap(weather_tex_opacity: f32) -> f32 {
    return safe_saturate(weather_tex_opacity * 1.25 - 0.1);
}

fn weather_noise_hash(cell: vec2<f32>) -> f32 {
    let h = dot(cell, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

fn weather_value_noise(position: vec2<f32>) -> f32 {
    let cell = floor(position);
    let local = fract(position);
    let curve = local * local * (3.0 - 2.0 * local);

    let a = weather_noise_hash(cell);
    let b = weather_noise_hash(cell + vec2<f32>(1.0, 0.0));
    let c = weather_noise_hash(cell + vec2<f32>(0.0, 1.0));
    let d = weather_noise_hash(cell + vec2<f32>(1.0, 1.0));

    return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
}

fn weather_fbm_two_octave(position: vec2<f32>) -> f32 {
    let first_octave = weather_value_noise(position);
    let second_octave = weather_value_noise(position * 2.03 + vec2<f32>(13.7, 5.9));
    return (first_octave + second_octave * 0.5) / 1.5;
}

fn compute_rain_opacity(weather_tex_opacity: f32) -> f32 {
    return square(weather_opacity_remap(weather_tex_opacity));
}

fn compute_snow_opacity(weather_tex_opacity: f32) -> f32 {
    return sqrt_curve_light(weather_opacity_remap(weather_tex_opacity));
}

fn weather_upness_mask(normal: vec3<f32>, threshold: f32) -> f32 {
    return smoothstep(threshold, 1.0, normalize(normal).y);
}

fn weather_puddle_mask(
    weather_kind_code: u32,
    flags: u32,
    wetness: f32,
    in_rainy: f32,
    puddle_strength: f32,
    time: f32,
    world_xz: vec2<f32>,
    normal: vec3<f32>,
    up_threshold: f32,
    detail_strength: f32,
) -> f32 {
    let weather_active_factor = select(
        0.0,
        1.0,
        weather_kind_code == WEATHER_KIND_RAIN || in_rainy > 0.001
    );
    let upness = weather_upness_mask(normal, up_threshold);
    let low_detail = (flags & WEATHER_FLAG_INTEGRATED_FALLBACK) != 0u ||
        (flags & WEATHER_FLAG_PUDDLE_DETAIL) == 0u;
    var detail = 1.0;
    if (!low_detail && detail_strength > 0.001) {
        let noise = weather_fbm_two_octave(world_xz * 0.085 + vec2<f32>(time * 0.015, 0.0));
        detail = mix(1.0, smoothstep(0.38, 0.82, noise), safe_saturate(detail_strength));
    }

    return clamp(
        wetness * puddle_strength * RAIN_PUDDLES * upness * detail * weather_active_factor,
        0.0,
        1.0
    );
}

fn weather_snow_mask(
    weather_kind_code: u32,
    flags: u32,
    snow_factor: f32,
    in_snowy: f32,
    snow_tint_strength: f32,
    world_xz: vec2<f32>,
    normal: vec3<f32>,
    up_threshold: f32,
    detail_strength: f32,
) -> f32 {
    let weather_active_factor = select(
        0.0,
        1.0,
        weather_kind_code == WEATHER_KIND_SNOW || in_snowy > 0.001
    );
    let upness = weather_upness_mask(normal, up_threshold);
    let low_detail = (flags & WEATHER_FLAG_INTEGRATED_FALLBACK) != 0u;
    var detail = 1.0;
    if (!low_detail && detail_strength > 0.001) {
        let noise = weather_fbm_two_octave(world_xz * 0.06 + vec2<f32>(3.1, 7.4));
        detail = mix(1.0, smoothstep(0.18, 0.72, noise), safe_saturate(detail_strength));
    }

    return clamp(
        snow_factor * snow_tint_strength * upness * detail * weather_active_factor,
        0.0,
        1.0
    );
}
