// Blocky terrain shader - uses texture array for material sampling
// Uses Bevy's standard vertex shader to avoid binding conflicts

#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::{pbr_fragment, pbr_functions, pbr_types}
#import bevy_pbr::mesh_view_bindings::globals
#import water_caustics
#import weather_common

const DEBUG_FORCE_ALBEDO: bool = false;
const DEBUG_ALBEDO_COLOR: vec4<f32> = vec4<f32>(1.0, 0.0, 1.0, 1.0);

// Material roughness - higher = more diffuse, less specular hotspots
const BLOCKY_ROUGHNESS: f32 = 0.9;
// AO strength - 0.0 = ignore vertex AO (brighter), 1.0 = full vertex AO (darker shadows)
const AO_STRENGTH: f32 = 0.15;
// Minimum brightness floor to prevent overly dark areas (Minecraft-style)
const MIN_BRIGHTNESS: f32 = 0.5;
// Minecraft-style directional face shading (top=brightest, sides=darker, bottom=darkest)
const FACE_SHADE_TOP: f32 = 1.0;
const FACE_SHADE_SIDE: f32 = 0.8;
const FACE_SHADE_BOTTOM: f32 = 0.6;
const BLOCKY_WEATHER_DEBUG_WETNESS: u32 = 1u << 11u;
const BLOCKY_WEATHER_DEBUG_SNOW: u32 = 1u << 12u;
const BLOCKY_WEATHER_DEBUG_PUDDLE: u32 = 1u << 13u;

struct BlockyUniforms {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    parallax_scale: f32,
    rain_factor: f32,
    wetness: f32,
    snow_factor: f32,
    weather_time: f32,
    weather_flags: u32,
    _weather_padding0: u32,
    _weather_padding1: u32,
    _weather_padding2: u32,
}

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: BlockyUniforms;

// Texture Array (12 layers: 4 materials * 3 faces each)
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var t_diffuse: texture_2d_array<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var s_diffuse: sampler;
// Normal texture bindings removed to fix conflict with Bevy's default vertex shader

fn blocky_wetness_mask(normal: vec3<f32>) -> f32 {
    let upness = weather_common::weather_upness_mask(normal, 0.22);
    return weather_common::safe_saturate(uniforms.rain_factor * uniforms.wetness * upness);
}

fn blocky_snow_mask(normal: vec3<f32>) -> f32 {
    let upness = weather_common::weather_upness_mask(normal, 0.35);
    return weather_common::safe_saturate(uniforms.snow_factor * upness);
}

fn blocky_puddle_mask(world_xz: vec2<f32>, normal: vec3<f32>) -> f32 {
    let upness = weather_common::weather_upness_mask(normal, 0.42);
    let low_detail = (uniforms.weather_flags & weather_common::WEATHER_FLAG_INTEGRATED_FALLBACK) != 0u ||
        (uniforms.weather_flags & weather_common::WEATHER_FLAG_PUDDLE_DETAIL) == 0u;
    var detail = 1.0;
    if (!low_detail) {
        let pooling = weather_common::weather_fbm_two_octave(
            world_xz * 0.075 + vec2<f32>(uniforms.weather_time * 0.012, 0.0)
        );
        detail = smoothstep(0.40, 0.84, pooling);
    }

    return weather_common::safe_saturate(uniforms.rain_factor * uniforms.wetness * upness * detail);
}

fn blocky_puddle_normal(base_normal: vec3<f32>, world_xz: vec2<f32>, puddle_mask: f32) -> vec3<f32> {
    if (puddle_mask <= 0.001) {
        return normalize(base_normal);
    }

    let ripple_a = weather_common::weather_value_noise(
        world_xz * 0.72 + vec2<f32>(uniforms.weather_time * 0.28, 0.0)
    );
    let ripple_b = weather_common::weather_value_noise(
        world_xz * 1.31 + vec2<f32>(-uniforms.weather_time * 0.19, uniforms.weather_time * 0.11)
    );
    let ripple_slope = (vec2<f32>(ripple_a, ripple_b) - vec2<f32>(0.5)) *
        (0.10 + uniforms.rain_factor * 0.06);
    let puddle_normal = normalize(vec3<f32>(ripple_slope.x, 1.0, ripple_slope.y));
    return normalize(mix(normalize(base_normal), puddle_normal, puddle_mask * 0.55));
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> @location(0) vec4<f32> {
    var pbr_input = pbr_fragment::pbr_input_from_vertex_output(in, is_front, true);

#ifdef VERTEX_COLORS
    let material_index = i32(in.color.a * 255.0 + 0.5);
    let vertex_ao = clamp(in.color.r, 0.0, 1.0);
#else
    let material_index = 0;
    let vertex_ao = 1.0;
#endif

    // Apply AO with controllable strength (0.0 = bright, 1.0 = full shadows)
    let ao = mix(1.0, vertex_ao, AO_STRENGTH);

    // Minecraft-style face shading based on normal direction
    let normal = normalize(pbr_input.world_normal);
    let up_factor = max(normal.y, 0.0);           // How much face points up (0-1)
    let down_factor = max(-normal.y, 0.0);        // How much face points down (0-1)
    let side_factor = 1.0 - abs(normal.y);        // How much face is vertical (0-1)
    let face_shade = up_factor * FACE_SHADE_TOP + side_factor * FACE_SHADE_SIDE + down_factor * FACE_SHADE_BOTTOM;

    // Texture array layers:
    // Grass: 0=Top, 1=Side, 2=Bottom
    // Dirt:  3=Top, 4=Side, 5=Bottom
    // Rock:  6=Top, 7=Side, 8=Bottom
    // Sand:  9=Top, 10=Side, 11=Bottom
    let layer = clamp(material_index, 0, 11);
    var diffuse = textureSample(t_diffuse, s_diffuse, in.uv, layer) * uniforms.base_color;
    var roughness = BLOCKY_ROUGHNESS;
    var shaded_normal = normalize(pbr_input.world_normal);

    var wetness_mask = 0.0;
    var snow_mask = 0.0;
    var puddle_mask = 0.0;
    if (uniforms.rain_factor > 0.001 || uniforms.wetness > 0.001 || uniforms.snow_factor > 0.001) {
        wetness_mask = blocky_wetness_mask(pbr_input.world_normal);
        diffuse = mix(diffuse, diffuse * vec4<f32>(0.84, 0.88, 0.92, 1.0), wetness_mask * 0.5);
        roughness = mix(roughness, 0.35, wetness_mask);

        puddle_mask = blocky_puddle_mask(pbr_input.world_position.xz, pbr_input.world_normal);
        diffuse = mix(diffuse, diffuse * vec4<f32>(0.74, 0.79, 0.86, 1.0), puddle_mask * 0.28);
        roughness = mix(roughness, 0.16, puddle_mask);
        shaded_normal = blocky_puddle_normal(shaded_normal, pbr_input.world_position.xz, puddle_mask);

        snow_mask = blocky_snow_mask(pbr_input.world_normal);
        diffuse = mix(diffuse, vec4<f32>(max(diffuse.rgb, vec3<f32>(0.88, 0.90, 0.94)), diffuse.a), snow_mask);
        roughness = mix(roughness, 0.78, snow_mask);
    }

    if ((uniforms.weather_flags & BLOCKY_WEATHER_DEBUG_WETNESS) != 0u) {
        diffuse = vec4<f32>(vec3<f32>(wetness_mask), 1.0);
        roughness = 0.9;
    } else if ((uniforms.weather_flags & BLOCKY_WEATHER_DEBUG_SNOW) != 0u) {
        diffuse = vec4<f32>(vec3<f32>(snow_mask), 1.0);
        roughness = 0.9;
    } else if ((uniforms.weather_flags & BLOCKY_WEATHER_DEBUG_PUDDLE) != 0u) {
        diffuse = vec4<f32>(vec3<f32>(puddle_mask), 1.0);
        roughness = 0.9;
    }

    // Apply face shading to diffuse color (Minecraft-style directional lighting)
    let shaded_diffuse = vec4<f32>(diffuse.rgb * face_shade, diffuse.a);
    pbr_input.material.base_color = shaded_diffuse;
    pbr_input.material.perceptual_roughness = roughness;
    pbr_input.material.metallic = 0.0;
    pbr_input.N = shaded_normal;
    pbr_input.diffuse_occlusion = vec3<f32>(ao);
    pbr_input.specular_occlusion = ao;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_DOUBLE_SIDED_BIT;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_FOG_ENABLED_BIT;

    if (DEBUG_FORCE_ALBEDO) {
        pbr_input.material.base_color = DEBUG_ALBEDO_COLOR;
        pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_UNLIT_BIT;
    }

    var color: vec4<f32>;
    if ((pbr_input.material.flags & pbr_types::STANDARD_MATERIAL_FLAGS_UNLIT_BIT) == 0u) {
        color = pbr_functions::apply_pbr_lighting(pbr_input);
        // Blend between PBR result and original texture to prevent over-darkening
        // This gives Minecraft-style lighting where shadows exist but aren't too dark
        let lit_brightness = max(max(color.r, color.g), color.b);
        if (lit_brightness < MIN_BRIGHTNESS) {
            let boost = (MIN_BRIGHTNESS - lit_brightness) / max(MIN_BRIGHTNESS, 0.001);
            color = vec4<f32>(mix(color.rgb, diffuse.rgb, boost * 0.6), color.a);
        }
    } else {
        color = pbr_input.material.base_color;
    }

    // Underwater caustics: add animated light patterns below water level
    let world_pos = pbr_input.world_position.xyz;
    let WATER_LEVEL = 18.0;
    if (world_pos.y < WATER_LEVEL) {
        let caustic_surface_mask = smoothstep(0.25, 0.65, pbr_input.world_normal.y);
        let shoreline_caustic_falloff = 1.0 - smoothstep(WATER_LEVEL - 0.5, WATER_LEVEL, world_pos.y);
        let caustic = water_caustics::calculate_caustics(
            world_pos, WATER_LEVEL, globals.time,
            0.85,   // caustic_intensity
            1.2     // caustic_scale
        ) * shoreline_caustic_falloff * caustic_surface_mask;
        color = vec4<f32>(color.rgb + water_caustics::caustic_color(caustic), color.a);
    }

    color = pbr_functions::main_pass_post_lighting_processing(pbr_input, color);
    return vec4<f32>(color.rgb, 1.0);
}
