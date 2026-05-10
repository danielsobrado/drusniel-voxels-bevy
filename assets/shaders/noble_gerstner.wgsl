// Ported from Noble Shaders by Belmu (GPL-3.0).
#define_import_path noble_gerstner

#ifdef PREPASS_PIPELINE
#import bevy_render::globals::Globals
@group(0) @binding(1) var<uniform> globals: Globals;
#else
#import bevy_pbr::mesh_view_bindings::globals
#endif

#import bevy_water::water_bindings::material

const NOBLE_G: f32 = 9.81;
const NOBLE_TAU: f32 = 6.28318530718;
const NOBLE_ROT_155: mat2x2<f32> = mat2x2<f32>(
    vec2<f32>(-0.9063078, 0.42261827),
    vec2<f32>(-0.42261827, -0.9063078)
);

fn noble_hash12(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

fn noble_value_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (vec2<f32>(3.0) - 2.0 * f);
    let a = noble_hash12(i);
    let b = noble_hash12(i + vec2<f32>(1.0, 0.0));
    let c = noble_hash12(i + vec2<f32>(0.0, 1.0));
    let d = noble_hash12(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn noble_fbm_2_octaves(uv: vec2<f32>, frequency: f32) -> f32 {
    // Noble's FBM is replaced with local 2-octave value noise to avoid extra texture bindings.
    return noble_value_noise(uv * frequency) + noble_value_noise(uv * frequency * 2.0) * 0.5;
}

fn noble_wave_speed() -> f32 {
    return max(material.wave_dir_a.x, 0.05);
}

fn noble_wave_amplitude() -> f32 {
    return max(material.amplitude, 0.0);
}

fn noble_wave_count(fallback_octaves: i32) -> i32 {
    let encoded = i32(clamp(round(material.wave_dir_a.y), 1.0, 32.0));
    return clamp(select(fallback_octaves, encoded, encoded > 1), 1, 32);
}

fn gerstnerWaves(
    coords: vec2<f32>,
    time: f32,
    steepness: f32,
    amplitude: f32,
    lambda: f32,
    direction: vec2<f32>,
) -> f32 {
    let k = NOBLE_TAU / max(lambda, 0.001);
    let d = normalize(direction);
    let x = sqrt(NOBLE_G * k) * time - k * dot(d, coords);
    return amplitude * pow(sin(x) * 0.5 + 0.5, steepness);
}

fn calculateWaveHeightGerstner(position: vec2<f32>, octaves: i32) -> f32 {
    var height = 0.0;

    let speed = noble_wave_speed();
    let time = globals.time * speed * 0.8;
    var steepness = 1.5;
    var amplitude = noble_wave_amplitude();
    var lambda = 5.0;
    var direction = vec2<f32>(0.2, 0.3);
    let layer_count = noble_wave_count(octaves);

    for (var i = 0; i < 32; i = i + 1) {
        if (i >= layer_count) {
            break;
        }

        let safe_lambda = max(lambda, 0.001);
        let noise = noble_fbm_2_octaves(position * inverseSqrt(safe_lambda) - (speed * direction), 1.0);
        height += gerstnerWaves(
            position + vec2<f32>(noise, -noise) * sqrt(safe_lambda),
            time,
            steepness,
            amplitude,
            safe_lambda,
            direction
        ) - noise * amplitude;

        steepness *= 1.05;
        amplitude *= 0.92;
        lambda *= 0.90;
        direction = NOBLE_ROT_155 * direction;
    }

    return height;
}

fn getWaterNormal(worldPosition: vec3<f32>, octaves: i32) -> vec3<f32> {
    let offset = vec2<f32>(0.015, 0.0);
    let pos0 = calculateWaveHeightGerstner(worldPosition.xz, octaves);
    let pos1 = calculateWaveHeightGerstner(worldPosition.xz + offset.xy, octaves);
    let pos2 = calculateWaveHeightGerstner(worldPosition.xz + offset.yx, octaves);
    return normalize(vec3<f32>(pos0 - pos1, 1.0, pos0 - pos2));
}

fn getWaterNormalStrength(worldPosition: vec3<f32>, strength: f32, octaves: i32) -> vec3<f32> {
    let d_step = 0.015;
    var steps = vec2<f32>(
        calculateWaveHeightGerstner(worldPosition.xz + vec2<f32>( d_step, -d_step), octaves),
        calculateWaveHeightGerstner(worldPosition.xz + vec2<f32>(-d_step,  d_step), octaves)
    );
    steps -= calculateWaveHeightGerstner(worldPosition.xz + vec2<f32>(-d_step, -d_step), octaves);
    steps *= strength;
    return normalize(vec3<f32>(-steps.x, d_step * 2.0, -steps.y));
}
