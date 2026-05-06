#define_import_path witchcraft_water_finish

struct WitchcraftWaterFinishParams {
    enabled: bool,
    style: u32,
    watercolor_mode: u32,
    legacy: bool,
    color_multiplier_enabled: bool,
    color_multiplier: vec3<f32>,
    reflect_b: u32,
    debug: u32,
}

struct WitchcraftWaterFinishUniform {
    flags: vec4<u32>,
    color_multiplier: vec4<f32>,
    params: vec4<f32>,
}

struct WitchcraftWaterFinishResult {
    color: vec4<f32>,
    reflect_mult: f32,
}

fn witchcraft_pow2(value: f32) -> f32 {
    return value * value;
}

fn witchcraft_luminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn apply_witchcraft_water_finish(
    params: WitchcraftWaterFinishParams,
    color_in: vec4<f32>,
    gl_color: vec3<f32>,
    color_p: vec3<f32>,
    fresnel: f32,
    ndot_umax0: f32,
    reflect_quality: bool,
) -> WitchcraftWaterFinishResult {
    var result: WitchcraftWaterFinishResult;
    result.color = color_in;
    result.reflect_mult = 1.0;

    if (!params.enabled) {
        return result;
    }

    if (params.legacy) {
        if (params.style < 3u) {
            let lum = witchcraft_luminance(result.color.rgb);
            let mixed = mix(result.color.rgb, vec3<f32>(lum), vec3<f32>(0.88));
            result.color = vec4<f32>(
                vec3<f32>(
                    witchcraft_pow2(mixed.r) * 2.3,
                    witchcraft_pow2(mixed.g) * 3.5,
                    witchcraft_pow2(mixed.b) * 3.1
                ) * 0.9,
                result.color.a
            );
        }
    } else {
        var gl_color_m: vec3<f32>;
        if (params.watercolor_mode >= 2u) {
            var source = max(gl_color, vec3<f32>(0.0));
            if (params.watercolor_mode >= 3u) {
                source.g = max(source.g, 0.39);
            }
            gl_color_m = sqrt(source) * vec3<f32>(1.0, 0.85, 0.8);
        } else {
            gl_color_m = vec3<f32>(0.43, 0.6, 0.8);
        }

        if (params.style < 3u) {
            result.color = vec4<f32>(color_p * color_p * gl_color_m, result.color.a);
        } else {
            result.color = vec4<f32>(0.375 * gl_color_m, result.color.a);
        }
    }

    if (params.color_multiplier_enabled) {
        result.color = vec4<f32>(result.color.rgb * params.color_multiplier, result.color.a);
    }

    result.reflect_mult = select(0.0, 1.0, params.reflect_b == 200u);
    let fresnel2 = witchcraft_pow2(fresnel);
    let fresnel4 = witchcraft_pow2(fresnel2);
    result.reflect_mult = result.reflect_mult * (0.3 + 0.3 * max(ndot_umax0, 0.0));
    result.color.a = select(
        mix(result.color.a, 0.5, fresnel4),
        mix(result.color.a, 1.0, fresnel4),
        reflect_quality
    );

    if (params.debug == 1u) {
        result.color = vec4<f32>(result.color.rgb, 1.0);
    } else if (params.debug == 2u) {
        result.color = vec4<f32>(vec3<f32>(fresnel4), 1.0);
    } else if (params.debug == 3u) {
        result.color = vec4<f32>(vec3<f32>(result.reflect_mult), 1.0);
    }

    return result;
}
