// Water Reflection Compositor — fullscreen post-process pass
//
// Runs after the main 3D forward pass. Reconstructs world-Y from the depth
// prepass to identify water-surface pixels, then blends the planar reflection
// texture into the scene using Schlick Fresnel.
//
// Inputs (group 0):
//   binding 0   — main HDR scene color (texture_2d)
//   binding 1   — sampler (shared for scene & reflection)
//   binding 2   — planar reflection texture (texture_2d)
//   binding 3   — depth prepass texture (texture_depth_2d, loaded per-pixel)
//   binding 4   — Bevy View uniform (inverse projection/view, world_position)

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput
#import bevy_render::view::View

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var reflection_texture: texture_2d<f32>;
@group(0) @binding(3) var depth_texture: texture_depth_2d;
@group(0) @binding(4) var<uniform> view: View;

// Baked constants — kept in sync with src/constants.rs and WaterConfig defaults.
const WATER_LEVEL: f32         = 18.0;
// Vertical tolerance in world units for detecting a water-surface pixel.
// Must be larger than wave amplitude (default 0.5 m) but small enough to
// avoid tagging terrain at nearly-the-same elevation.
const WATER_TOLERANCE: f32     = 1.2;
const FRESNEL_POWER: f32       = 5.0;
const REFLECTION_STRENGTH: f32 = 0.85;
// Screen-UV distortion amplitude (simulates Gerstner wave normal distortion)
const DISTORTION_STRENGTH: f32 = 0.006;

// Reconstruct world-space position from the depth prepass value and screen UV.
fn reconstruct_world_pos(screen_uv: vec2<f32>, depth: f32) -> vec3<f32> {
    // Bevy screen UV: (0,0) top-left, NDC +Y upward
    let ndc_xy = vec2<f32>(screen_uv.x * 2.0 - 1.0,
                           (1.0 - screen_uv.y) * 2.0 - 1.0);
    let clip = vec4<f32>(ndc_xy, depth, 1.0);

    let view_h = view.clip_from_world_inverse * clip;
    return view_h.xyz / view_h.w;
}

// Approximate spatial UV distortion based on world XZ position.
fn wave_distortion(world_xz: vec2<f32>) -> vec2<f32> {
    let a = sin(world_xz.x * 2.3 + world_xz.y * 1.7);
    let b = cos(world_xz.x * 1.9 + world_xz.y * 2.1);
    return vec2<f32>(a, b) * DISTORTION_STRENGTH;
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSample(scene_texture, scene_sampler, in.uv);

    // Load depth (integer pixel coords, no interpolation needed)
    let pixel = vec2<i32>(in.position.xy);
    let depth = textureLoad(depth_texture, pixel, 0);

    // Bevy uses reversed-Z: depth==0 means far plane (sky). Skip it.
    if depth <= 0.0 {
        return scene;
    }

    let world_pos = reconstruct_world_pos(in.uv, depth);

    // Gate to water-surface pixels only
    if abs(world_pos.y - WATER_LEVEL) > WATER_TOLERANCE {
        return scene;
    }

    // Fresnel: water normal ≈ (0,1,0), so NdotV = view_dir.y
    let view_dir = normalize(view.world_position.xyz - world_pos);
    let NdotV    = max(view_dir.y, 0.0);
    let fresnel  = pow(1.0 - NdotV, FRESNEL_POWER);

    // Sample reflection texture.
    // The reflection camera mirrors the main camera's Y across the water plane,
    // so for a horizontal water surface the reflection UV is (u, 1-v) plus
    // a small wave-driven distortion.
    let distort  = wave_distortion(world_pos.xz);
    let refl_uv  = clamp(
        vec2<f32>(in.uv.x + distort.x, 1.0 - in.uv.y + distort.y),
        vec2<f32>(0.001),
        vec2<f32>(0.999),
    );
    let reflection = textureSample(reflection_texture, scene_sampler, refl_uv);

    let blend = fresnel * REFLECTION_STRENGTH;
    return vec4<f32>(mix(scene.rgb, reflection.rgb, blend), scene.a);
}
