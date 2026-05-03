// Water Reflection Compositor - fullscreen post-process pass.
//
// The mask is rendered from actual WaterMesh geometry. Depth/world-y tests are
// intentionally not part of the production path.

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput

struct ReflectionCompositorUniform {
    flags: vec4<u32>,
    params: vec4<f32>,
}

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var reflection_texture: texture_2d<f32>;
@group(0) @binding(3) var water_mask_texture: texture_2d<f32>;
@group(0) @binding(4) var<uniform> reflection_state: ReflectionCompositorUniform;

fn mask_value(mask_sample: vec4<f32>) -> f32 {
    return clamp(max(max(mask_sample.r, mask_sample.g), mask_sample.b), 0.0, 1.0);
}

fn wave_distortion(uv: vec2<f32>, surface_y: f32, strength: f32) -> vec2<f32> {
    let a = sin(uv.x * 38.0 + uv.y * 21.0 + surface_y * 0.11);
    let b = cos(uv.x * 27.0 - uv.y * 34.0 + surface_y * 0.07);
    return vec2<f32>(a, b) * strength;
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSample(scene_texture, scene_sampler, in.uv);
    let mask = mask_value(textureSample(water_mask_texture, scene_sampler, in.uv));
    let reflection_enabled = reflection_state.flags.x != 0u;
    let debug_view = reflection_state.flags.y;

    if debug_view == 1u {
        return vec4<f32>(vec3<f32>(mask), 1.0);
    }

    if mask <= 0.01 {
        return scene;
    }

    let reflection_strength = clamp(reflection_state.params.x, 0.0, 1.0);
    let fresnel_power = max(reflection_state.params.y, 0.25);
    let distortion_strength = max(reflection_state.params.z, 0.0);
    let surface_y = reflection_state.params.w;

    let distort = wave_distortion(in.uv, surface_y, distortion_strength);
    let refl_uv = clamp(
        vec2<f32>(in.uv.x + distort.x, 1.0 - in.uv.y + distort.y),
        vec2<f32>(0.001),
        vec2<f32>(0.999),
    );
    let reflection = textureSample(reflection_texture, scene_sampler, refl_uv);

    let screen_grazing = clamp(1.0 - in.uv.y, 0.0, 1.0);
    let fresnel = pow(screen_grazing, fresnel_power);
    let blend = clamp(mask * reflection_strength * max(fresnel, 0.28), 0.0, 1.0);

    if debug_view == 2u {
        return vec4<f32>(reflection.rgb * mask, 1.0);
    }
    if debug_view == 3u {
        return vec4<f32>(vec3<f32>(blend), 1.0);
    }
    if !reflection_enabled {
        return scene;
    }

    return vec4<f32>(mix(scene.rgb, reflection.rgb, blend), scene.a);
}
