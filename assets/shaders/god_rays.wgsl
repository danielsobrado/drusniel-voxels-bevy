// Screen-Space God Rays — fullscreen post-process pass
//
// Performs a radial blur from each pixel toward the sun's screen-space position,
// accumulating bright pixels along each ray. The result is blended additively
// onto the scene for a volumetric light shaft effect.
//
// Based on the GPU Gems 3 technique (Mitchell 2007), adapted for Bevy's
// reversed-Z depth buffer and HDR pipeline.
//
// Inputs (group 0):
//   binding 0   — main HDR scene color (texture_2d)
//   binding 1   — sampler
//   binding 2   — depth prepass texture (texture_depth_2d)
//   binding 3   — GodRayUniforms (sun screen pos, intensity, etc.)
//   binding 4   — Bevy View uniform

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput
#import bevy_render::view::View

struct GodRayUniforms {
    // Sun position in normalized screen UV (0..1, 0..1). W=1 if sun is in front of camera, 0 if behind.
    sun_screen_pos: vec4<f32>,
    // Sun direction in world space (normalized, pointing toward sun).
    sun_dir_world: vec4<f32>,
    // Configurable parameters
    intensity: f32,
    decay: f32,
    density: f32,
    weight: f32,
    num_samples: i32,
    // Luminance threshold — only pixels brighter than this contribute to shafts
    threshold: f32,
    rain_factor: f32,
    snow_factor: f32,
    naadf_froxel_visibility: f32,
    naadf_froxel_strength: f32,
}

struct GodRayFroxelParams {
    grid: vec4<u32>,
    camera_origin_max_distance: vec4<f32>,
    camera_forward_fov_y: vec4<f32>,
    camera_right_aspect: vec4<f32>,
    camera_up_pad: vec4<f32>,
    sun_direction_pad: vec4<f32>,
    config: vec4<u32>,
}

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var depth_texture: texture_depth_2d;
@group(0) @binding(3) var<uniform> uniforms: GodRayUniforms;
@group(0) @binding(4) var<uniform> view: View;
@group(0) @binding(5) var<uniform> naadf_froxel_params: GodRayFroxelParams;
@group(0) @binding(6) var<storage, read> naadf_froxel_mask: array<u32>;

// Approximate luminance of an HDR color
fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn naadf_froxel_cell_visibility(x: u32, y: u32, z: u32) -> f32 {
    let grid = naadf_froxel_params.grid.xyz;
    let index = x + y * grid.x + z * grid.x * grid.y;
    return select(0.0, 1.0, naadf_froxel_mask[index] != 0u);
}

fn naadf_froxel_depth_sample_count(depth_slices: u32) -> u32 {
    return clamp(depth_slices / 16u, 4u, 16u);
}

fn naadf_froxel_column_visibility(uv: vec2<f32>) -> f32 {
    let grid = naadf_froxel_params.grid.xyz;
    if naadf_froxel_params.grid.w == 0u || any(grid == vec3<u32>(0u)) {
        return 1.0;
    }

    let clamped_uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(0.999999));
    let cell_xy = min(vec2<u32>(clamped_uv * vec2<f32>(grid.xy)), grid.xy - vec2<u32>(1u));
    let sample_count = naadf_froxel_depth_sample_count(grid.z);
    var visibility = 0.0;
    for (var sample = 0u; sample < sample_count; sample++) {
        let slice_f = (f32(sample) + 0.5) / f32(sample_count);
        let z = min(u32(slice_f * f32(grid.z)), grid.z - 1u);
        visibility += naadf_froxel_cell_visibility(cell_xy.x, cell_xy.y, z);
    }
    return visibility / f32(sample_count);
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSample(scene_texture, scene_sampler, in.uv);

    // Skip if sun is behind the camera
    if uniforms.sun_screen_pos.w < 0.5 {
        return vec4<f32>(scene.rgb, 1.0);
    }

    let sun_uv = uniforms.sun_screen_pos.xy;

    let sample_count = clamp(uniforms.num_samples, 1, 128);

    // Direction from this pixel toward the sun in screen space
    let delta_uv = (sun_uv - in.uv) * uniforms.density / f32(sample_count);

    // March toward the sun, accumulating scattered light
    var uv = in.uv;
    var accumulated = vec3<f32>(0.0);
    var illumination_decay = 1.0;
    let rain_factor = clamp(uniforms.rain_factor, 0.0, 1.0);
    let snow_factor = clamp(uniforms.snow_factor, 0.0, 1.0);
    let weather_intensity_mult = clamp(1.0 - rain_factor * 0.55 - snow_factor * 0.1, 0.35, 1.0);
    let weather_threshold = max(uniforms.threshold * (1.0 - snow_factor * 0.18), 0.05);
    // V1 samples the output pixel's froxel column as "air along this view ray".
    // It deliberately does not sample along the radial blur path, and it conflates
    // near/far occlusion within the column until a depth-localized fog model exists.
    let naadf_froxel_visibility = mix(
        1.0,
        naadf_froxel_column_visibility(in.uv),
        clamp(uniforms.naadf_froxel_strength, 0.0, 1.0),
    );

    for (var i = 0; i < sample_count; i++) {
        uv += delta_uv;

        // Clamp to valid UV range
        let sample_uv = clamp(uv, vec2<f32>(0.001), vec2<f32>(0.999));

        // Sample scene color at this point along the ray
        let sample_color = textureSample(scene_texture, scene_sampler, sample_uv).rgb;

        // Load depth to distinguish sky from geometry
        let pixel = vec2<i32>(sample_uv * vec2<f32>(textureDimensions(depth_texture)));
        let depth = textureLoad(depth_texture, pixel, 0);

        // Bevy reversed-Z: depth near 0 = sky/far plane.
        // Sky pixels contribute fully; geometry pixels contribute based on brightness.
        var contribution = sample_color;
        if depth > 0.001 {
            // Geometry pixel — only contribute if very bright (sun-lit surfaces)
            let lum = luminance(sample_color);
            let bright_mask = smoothstep(weather_threshold, weather_threshold + 1.0, lum);
            contribution = sample_color * bright_mask;
        }

        accumulated += contribution * illumination_decay * uniforms.weight;
        illumination_decay *= uniforms.decay;
    }

    // Directional attenuation: god rays are strongest when looking toward the sun.
    // Fade based on distance from pixel to sun position on screen.
    let dist_to_sun = length(in.uv - sun_uv);
    let directional_fade = 1.0 - smoothstep(0.0, 1.5, dist_to_sun);

    let god_rays = accumulated *
        uniforms.intensity *
        weather_intensity_mult *
        directional_fade *
        naadf_froxel_visibility;

    // Additive blend onto the scene
    return vec4<f32>(scene.rgb + god_rays, 1.0);
}
