// Water Reflection Compositor - fullscreen post-process pass.
//
// The mask is rendered from actual WaterMesh geometry, then clipped against
// foreground scene depth so water behind buildings/props does not leak forward.

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput
#import bevy_render::view::View

struct CompositorWeatherUniforms {
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

struct ReflectionCompositorUniform {
    flags: vec4<u32>,
    params: vec4<f32>,
    // x = max distance for accepting sky-depth water mask pixels.
    params2: vec4<f32>,
    weather: CompositorWeatherUniforms,
    // x = rain_distortion_boost, y = rain_reflection_boost, z = snow_reflection_soften.
    weather_water: vec4<f32>,
    // x = enabled, y = strength, z = ior, w = chromatic aberration request.
    refraction: vec4<f32>,
}

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var reflection_texture: texture_2d<f32>;
@group(0) @binding(3) var water_mask_texture: texture_2d<f32>;
@group(0) @binding(4) var<uniform> reflection_state: ReflectionCompositorUniform;
@group(0) @binding(5) var scene_depth_texture: texture_depth_2d;
@group(0) @binding(6) var<uniform> view: View;

fn mask_value(mask_sample: vec4<f32>) -> f32 {
    return clamp(max(max(mask_sample.r, mask_sample.g), mask_sample.b), 0.0, 1.0);
}

fn uv_to_ndc(uv: vec2<f32>) -> vec2<f32> {
    return uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0);
}

fn scene_depth_at_uv(uv: vec2<f32>) -> f32 {
    let dimensions = vec2<i32>(textureDimensions(scene_depth_texture));
    let max_pixel = dimensions - vec2<i32>(1);
    let pixel = clamp(vec2<i32>(uv * vec2<f32>(dimensions)), vec2<i32>(0), max_pixel);
    return textureLoad(scene_depth_texture, pixel, 0);
}

fn scene_world_y_from_depth(uv: vec2<f32>, depth: f32) -> f32 {
    let world_h = view.world_from_clip * vec4<f32>(uv_to_ndc(uv), depth, 1.0);
    if abs(world_h.w) <= 0.00001 {
        return reflection_state.params.w;
    }
    return world_h.y / world_h.w;
}

fn water_plane_hit_distance(uv: vec2<f32>, surface_y: f32) -> f32 {
    let far_h = view.world_from_clip * vec4<f32>(uv_to_ndc(uv), 0.0, 1.0);
    if abs(far_h.w) <= 0.00001 {
        return -1.0;
    }

    let far_world = far_h.xyz / far_h.w;
    let ray = far_world - view.world_position.xyz;
    if length(ray) <= 0.0001 {
        return -1.0;
    }

    let direction = normalize(ray);
    if abs(direction.y) <= 0.00001 {
        return -1.0;
    }

    let t = (surface_y - view.world_position.y) / direction.y;
    return select(-1.0, t, t > 0.0);
}

fn occlusion_aware_mask(raw_mask: f32, uv: vec2<f32>, surface_y: f32) -> f32 {
    if raw_mask <= 0.01 {
        return 0.0;
    }

    // Bevy uses reversed-Z. Near/opaque depth is > 0; sky/far clear is near 0.
    let depth = scene_depth_at_uv(uv);
    if depth <= 0.0001 {
        let hit_distance = water_plane_hit_distance(uv, surface_y);
        let max_distance = max(reflection_state.params2.x, 1.0);
        return select(0.0, raw_mask, hit_distance > 0.0 && hit_distance <= max_distance);
    }

    let scene_delta = scene_world_y_from_depth(uv, depth) - surface_y;
    let clearance = 0.02;

    if scene_delta > clearance + 0.25 {
        return 0.0;
    }

    let terrain_occlusion = smoothstep(0.0, 0.25, scene_delta);
    return raw_mask * (1.0 - terrain_occlusion);
}

fn wave_distortion(uv: vec2<f32>, surface_y: f32, strength: f32) -> vec2<f32> {
    let a = sin(uv.x * 38.0 + uv.y * 21.0 + surface_y * 0.11);
    let b = cos(uv.x * 27.0 - uv.y * 34.0 + surface_y * 0.07);
    return vec2<f32>(a, b) * strength;
}

fn screen_border_attenuation(uv: vec2<f32>) -> f32 {
    let edge_distance = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    return smoothstep(0.0, 0.08, edge_distance);
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSample(scene_texture, scene_sampler, in.uv);
    let reflection_enabled = reflection_state.flags.x != 0u;
    let debug_view = reflection_state.flags.y;
    let surface_y = reflection_state.params.w;
    let mask = occlusion_aware_mask(
        mask_value(textureSample(water_mask_texture, scene_sampler, in.uv)),
        in.uv,
        surface_y
    );

    if debug_view == 1u {
        return vec4<f32>(vec3<f32>(mask), 1.0);
    }

    if mask <= 0.01 {
        return vec4<f32>(scene.rgb, 1.0);
    }

    let rain_factor = clamp(reflection_state.weather.rain_factor, 0.0, 1.0);
    let snow_factor = clamp(reflection_state.weather.snow_factor, 0.0, 1.0);
    let wetness = clamp(reflection_state.weather.wetness, 0.0, 1.0);
    let rain_distortion_boost = rain_factor * max(reflection_state.weather_water.x, 0.0);
    let rain_reflection_boost = rain_factor * max(reflection_state.weather_water.y, 0.0);
    let snow_reflection_soften = clamp(snow_factor * reflection_state.weather_water.z, 0.0, 1.0);

    let reflection_strength = clamp(reflection_state.params.x + wetness * 0.12 + rain_reflection_boost, 0.0, 1.0);
    let fresnel_power = max(reflection_state.params.y, 0.25);
    let distortion_strength = max(reflection_state.params.z, 0.0) * (1.0 + rain_distortion_boost);
    let border_mask = screen_border_attenuation(in.uv);

    let refraction_enabled = reflection_state.refraction.x > 0.5;
    let refraction_strength = select(0.0, max(reflection_state.refraction.y, 0.0), refraction_enabled);
    let refraction_ior_scale = clamp((max(reflection_state.refraction.z, 1.0) - 1.0) / 0.33, 0.35, 1.5);
    var base_scene = scene;
    if (refraction_strength > 0.0001) {
        let refraction_distortion = wave_distortion(
            in.uv + vec2<f32>(0.31, 0.17),
            surface_y + 11.0,
            refraction_strength * refraction_ior_scale * (1.0 + rain_distortion_boost * 0.5) * border_mask
        );
        let refraction_uv = clamp(in.uv + refraction_distortion, vec2<f32>(0.001), vec2<f32>(0.999));
        let refracted_scene = textureSample(scene_texture, scene_sampler, refraction_uv);
        let refraction_blend = mask * clamp(refraction_strength * 7.5, 0.0, 0.28) * border_mask;
        base_scene = vec4<f32>(mix(scene.rgb, refracted_scene.rgb, refraction_blend), 1.0);
    }

    let distort = wave_distortion(in.uv, surface_y, distortion_strength);
    let refl_uv = clamp(
        vec2<f32>(in.uv.x + distort.x, 1.0 - in.uv.y + distort.y),
        vec2<f32>(0.001),
        vec2<f32>(0.999),
    );
    let reflection = textureSample(reflection_texture, scene_sampler, refl_uv);

    let screen_grazing = clamp(1.0 - in.uv.y, 0.0, 1.0);
    let fresnel = pow(screen_grazing, fresnel_power);
    let raw_blend = mask * reflection_strength * max(fresnel, 0.28);
    let blend = clamp(raw_blend * (1.0 - snow_reflection_soften), 0.0, 1.0);

    if debug_view == 2u {
        return vec4<f32>(reflection.rgb * mask, 1.0);
    }
    if debug_view == 3u {
        return vec4<f32>(vec3<f32>(blend), 1.0);
    }
    if !reflection_enabled {
        return vec4<f32>(base_scene.rgb, 1.0);
    }

    return vec4<f32>(mix(base_scene.rgb, reflection.rgb, blend), 1.0);
}
