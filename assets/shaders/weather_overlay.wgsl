// Shader-generated precipitation overlay.
//
// A fullscreen post pass synthesizes rain and snow from screen-space hash noise.
// It does not use CPU particles, storage buffers, or generated precipitation textures.

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput
#import weather_common::{
    safe_saturate,
    weather_noise_hash,
    weather_opacity_remap,
}

struct WeatherOverlayShaderUniforms {
    weather_kind_code: u32,
    flags: u32,
    rain_factor: f32,
    rain_factor2: f32,
    inv_rain_factor: f32,
    inv_rain_factor_sqrt: f32,
    wetness: f32,
    snow_factor: f32,
    in_dry: f32,
    in_rainy: f32,
    in_snowy: f32,
    overlay_density: f32,
    puddle_strength: f32,
    snow_tint_strength: f32,
    time: f32,
    _padding: f32,
};

struct WeatherOverlayUniform {
    weather: WeatherOverlayShaderUniforms,
    // x = overlay density, y = quality code, z = debug mode, w = WEATHER_TEX_OPACITY input.
    params: vec4<f32>,
    // x = underwater, y = enabled, z = dominant precipitation kind, w = pass active.
    flags: vec4<u32>,
};

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var<uniform> overlay_state: WeatherOverlayUniform;

fn overlay_alpha_threshold(alpha: f32) -> f32 {
    return select(0.0, alpha, alpha >= 0.1);
}

fn rain_streak_mask(uv: vec2<f32>, time: f32, density: f32, quality: f32) -> f32 {
    let quality_scale = mix(0.62, 1.0, step(2.0, quality));
    let wind = vec2<f32>(0.34, -1.0);
    let slanted = vec2<f32>(
        uv.x + uv.y * 0.38 + time * 0.42 + wind.x * time * 0.03,
        uv.y * 2.65 + time * 3.25
    );
    let grid = vec2<f32>(118.0, 58.0) * quality_scale;
    let cell = floor(slanted * grid);
    let local = fract(slanted * grid);
    let seed = weather_noise_hash(cell);
    let visible = step(1.0 - safe_saturate(density) * 0.78, seed);
    let center = 0.5 + (seed - 0.5) * 0.26;
    let line = smoothstep(0.065, 0.0, abs(local.x - center));
    let trail = smoothstep(0.04, 0.22, local.y) * (1.0 - smoothstep(0.58, 1.0, local.y));
    return visible * line * trail;
}

fn snow_flake_mask(uv: vec2<f32>, time: f32, density: f32, quality: f32) -> f32 {
    let quality_scale = mix(0.7, 1.0, step(2.0, quality));
    let drift = vec2<f32>(
        sin(time * 0.35 + uv.y * 5.0) * 0.06,
        time * 0.16
    );
    let grid = vec2<f32>(76.0, 42.0) * quality_scale;
    let p = uv * grid + drift;
    let cell = floor(p);
    let local = fract(p) - vec2<f32>(0.5);
    let seed = weather_noise_hash(cell);
    let visible = step(1.0 - safe_saturate(density) * 0.58, seed);
    let radius = mix(0.055, 0.15, weather_noise_hash(cell + vec2<f32>(9.2, 4.7)));
    let flake = smoothstep(radius, 0.0, length(local));
    return visible * flake;
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSample(scene_texture, scene_sampler, in.uv);
    if overlay_state.flags.x != 0u || overlay_state.flags.y == 0u || overlay_state.flags.w == 0u {
        return vec4<f32>(scene.rgb, 1.0);
    }

    let weather = overlay_state.weather;
    let overlay_density = safe_saturate(overlay_state.params.x);
    if overlay_density <= 0.001 {
        return vec4<f32>(scene.rgb, 1.0);
    }

    let quality = overlay_state.params.y;
    let debug_mode = u32(overlay_state.params.z + 0.5);
    let opacity_scale = safe_saturate(
        weather_opacity_remap(overlay_state.params.w) / max(weather_opacity_remap(0.72), 0.001)
    );
    let rain_density = overlay_density * safe_saturate(weather.rain_factor);
    let snow_density = overlay_density * safe_saturate(weather.snow_factor);

    let rain_mask = select(
        0.0,
        rain_streak_mask(in.uv, weather.time, rain_density, quality),
        rain_density > 0.001
    );
    let snow_mask = select(
        0.0,
        snow_flake_mask(in.uv, weather.time, snow_density, quality),
        snow_density > 0.001
    );

    let rain_alpha = overlay_alpha_threshold(rain_mask * rain_density * 0.35 * opacity_scale);
    let snow_alpha = overlay_alpha_threshold(snow_mask * snow_density * 0.5 * opacity_scale);
    let overlay_mask = safe_saturate(max(rain_alpha, snow_alpha) * 3.0);

    if debug_mode == 1u {
        return vec4<f32>(vec3<f32>(overlay_mask), 1.0);
    }
    if debug_mode == 2u {
        let rain_class = vec3<f32>(0.16, 0.38, 1.0) * safe_saturate(rain_alpha * 3.0);
        let snow_class = vec3<f32>(1.0, 1.0, 1.0) * safe_saturate(snow_alpha * 3.0);
        return vec4<f32>(max(rain_class, snow_class), 1.0);
    }

    var color = scene.rgb;
    if rain_alpha > 0.0 {
        let rain_tint = vec3<f32>(0.56, 0.68, 0.82);
        let rain_mix = clamp(rain_alpha, 0.0, 0.42);
        color = mix(color, color * 0.92 + rain_tint * 0.16, rain_mix);
        color = mix(color, color * vec3<f32>(0.965, 0.975, 0.99), rain_density * 0.035);
    }

    if snow_alpha > 0.0 {
        let snow_mix = clamp(snow_alpha, 0.0, 0.5);
        color = mix(color, color + vec3<f32>(0.28, 0.30, 0.33), snow_mix);
        color = mix(color, color * vec3<f32>(1.015, 1.02, 1.035), snow_density * 0.025);
    }

    return vec4<f32>(color, 1.0);
}
