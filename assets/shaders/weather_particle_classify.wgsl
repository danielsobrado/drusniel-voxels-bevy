// Shader-side classification and recoloring for weather-like textured particles.
//
// This helper is intentionally inert until a particle or sprite shader imports it.
// Future integration point: after sampling a particle/sprite texture and before
// alpha discard or final color output, call apply_weather_particle_color(tex_color, weather).

#define_import_path weather_particle_classify

#import weather_common::safe_saturate

struct ParticleWeatherUniforms {
    weather_kind_code: u32,
    flags: u32,
    rain_factor: f32,
    rain_factor_squared: f32,
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

fn weather_particle_luminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

fn is_weather_water_particle(color: vec3<f32>, alpha: f32) -> bool {
    let brightness = max(max(color.r, color.g), color.b);
    let blue_green = (color.g + color.b) * 0.5;
    return alpha > 0.05 &&
        alpha < 0.95 &&
        brightness > 0.12 &&
        color.b >= color.r * 1.08 &&
        color.b >= color.g * 0.75 &&
        blue_green > color.r * 1.2;
}

fn is_weather_rain_particle(color: vec3<f32>, alpha: f32) -> bool {
    return is_weather_water_particle(color, alpha) &&
        alpha <= 0.65 &&
        weather_particle_luminance(color) < 0.82;
}

fn is_weather_snow_particle(color: vec3<f32>, alpha: f32) -> bool {
    let min_channel = min(min(color.r, color.g), color.b);
    let max_channel = max(max(color.r, color.g), color.b);
    return alpha > 0.1 &&
        weather_particle_luminance(color) > 0.65 &&
        min_channel > 0.45 &&
        (max_channel - min_channel) < 0.18;
}

fn apply_weather_particle_color(color: vec4<f32>, weather: ParticleWeatherUniforms) -> vec4<f32> {
    if ((weather.flags & 1u) == 0u) {
        return color;
    }

    var result = color;
    if (is_weather_rain_particle(color.rgb, color.a)) {
        let rain_amount = safe_saturate(weather.rain_factor);
        let rain_tint = vec3<f32>(0.58, 0.70, 0.86);
        result.rgb = mix(result.rgb, rain_tint, rain_amount * 0.55);
        result.a *= mix(1.0, 0.85, rain_amount);
    }

    if (is_weather_snow_particle(color.rgb, color.a)) {
        let snow_amount = safe_saturate(weather.snow_factor);
        let snow_tint = vec3<f32>(0.94, 0.97, 1.0);
        result.rgb = mix(result.rgb, snow_tint, snow_amount * 0.65);
        result.a *= mix(1.0, 0.92, snow_amount);
    }

    return result;
}
