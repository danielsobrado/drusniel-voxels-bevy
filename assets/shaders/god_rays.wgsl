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
    _padding: vec2<f32>,
}

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var depth_texture: texture_depth_2d;
@group(0) @binding(3) var<uniform> uniforms: GodRayUniforms;
@group(0) @binding(4) var<uniform> view: View;

// Approximate luminance of an HDR color
fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSample(scene_texture, scene_sampler, in.uv);

    // Skip if sun is behind the camera
    if uniforms.sun_screen_pos.w < 0.5 {
        return scene;
    }

    let sun_uv = uniforms.sun_screen_pos.xy;

    // Direction from this pixel toward the sun in screen space
    let delta_uv = (sun_uv - in.uv) * uniforms.density / f32(uniforms.num_samples);

    // March toward the sun, accumulating scattered light
    var uv = in.uv;
    var accumulated = vec3<f32>(0.0);
    var illumination_decay = 1.0;

    for (var i = 0; i < uniforms.num_samples; i++) {
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
            let bright_mask = smoothstep(uniforms.threshold, uniforms.threshold + 1.0, lum);
            contribution = sample_color * bright_mask;
        }

        accumulated += contribution * illumination_decay * uniforms.weight;
        illumination_decay *= uniforms.decay;
    }

    // Directional attenuation: god rays are strongest when looking toward the sun.
    // Fade based on distance from pixel to sun position on screen.
    let dist_to_sun = length(in.uv - sun_uv);
    let directional_fade = 1.0 - smoothstep(0.0, 1.5, dist_to_sun);

    let god_rays = accumulated * uniforms.intensity * directional_fade;

    // Additive blend onto the scene
    return vec4<f32>(scene.rgb + god_rays, scene.a);
}
