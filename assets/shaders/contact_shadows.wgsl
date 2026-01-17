// Contact Shadows for Vegetation Micro-detail
// Enshrouded-style screen-space contact shadows optimized for foliage
// 
// Features:
// - Screen-space ray marching for high-frequency shadow detail
// - Thickness-aware shadowing for grass blades and leaves
// - Dithered jitter for temporal stability
// - Distance-scaled step count for performance

#define_import_path contact_shadows

// Contact shadow parameters
struct ContactShadowParams {
    ray_length: f32,         // Maximum ray length in world units
    step_count: u32,         // Number of ray steps (4-16 typical)
    thickness: f32,          // Depth comparison thickness
    bias: f32,               // Depth bias to prevent self-shadowing
    fade_distance: f32,      // Distance at which shadows fade out
    dither_strength: f32,    // Temporal dither amount
    sun_direction: vec3<f32>, // Light direction (toward light)
    _padding: f32,
};

// Screen-space depth texture (from depth prepass)
// These would be bound in the material that uses contact shadows
// @group(1) @binding(0) var depth_texture: texture_depth_2d;
// @group(1) @binding(1) var depth_sampler: sampler;

const PI: f32 = 3.14159265359;

// Hash function for dithered jitter
fn pcg_hash(input: u32) -> u32 {
    let state = input * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn random_float(seed: u32) -> f32 {
    return f32(pcg_hash(seed)) / 4294967295.0;
}

// Interleaved gradient noise for stable dithering
fn interleaved_gradient_noise(uv: vec2<f32>, frame: u32) -> f32 {
    let magic = vec3<f32>(0.06711056, 0.00583715, 52.9829189);
    let frame_offset = 5.588238 * f32(frame);
    return fract(magic.z * fract(dot(uv + frame_offset, magic.xy)));
}

// Screen-space contact shadows
// Returns shadow factor: 0 = fully shadowed, 1 = fully lit
fn calculate_contact_shadow(
    world_position: vec3<f32>,
    world_normal: vec3<f32>,
    view_position: vec3<f32>,       // View-space position
    screen_uv: vec2<f32>,
    depth_texture: texture_depth_2d,
    depth_sampler: sampler,
    view_proj: mat4x4<f32>,
    params: ContactShadowParams,
    frame_index: u32,
) -> f32 {
    // Early out for surfaces facing away from light
    let n_dot_l = dot(world_normal, params.sun_direction);
    if n_dot_l < -0.1 {
        return 0.2; // Ambient shadow for back-facing
    }

    // Distance-based scaling
    let view_distance = length(view_position);
    let distance_fade = saturate(1.0 - view_distance / params.fade_distance);
    if distance_fade < 0.01 {
        return 1.0;
    }

    // Calculate ray in world space
    let ray_start = world_position + world_normal * params.bias;
    let ray_end = ray_start + params.sun_direction * params.ray_length;

    // Dithered offset for temporal stability
    let dither = interleaved_gradient_noise(screen_uv * 512.0, frame_index);
    let step_offset = dither * params.dither_strength;

    // Ray march in screen space
    var shadow = 1.0;
    let step_count = min(params.step_count, 16u);
    
    for (var i = 0u; i < step_count; i++) {
        let t = (f32(i) + step_offset) / f32(step_count);
        let sample_world_pos = mix(ray_start, ray_end, t);
        
        // Project to screen space
        let clip_pos = view_proj * vec4<f32>(sample_world_pos, 1.0);
        if clip_pos.w <= 0.0 {
            continue;
        }
        
        let ndc = clip_pos.xyz / clip_pos.w;
        let sample_uv = ndc.xy * 0.5 + 0.5;
        let sample_depth = ndc.z;
        
        // Check screen bounds
        if any(sample_uv < vec2<f32>(0.0)) || any(sample_uv > vec2<f32>(1.0)) {
            continue;
        }
        
        // Sample scene depth
        let scene_depth = textureSample(depth_texture, depth_sampler, sample_uv);
        
        // Depth comparison with thickness
        let depth_diff = scene_depth - sample_depth;
        if depth_diff > 0.0 && depth_diff < params.thickness {
            // Found occluder - soft shadow falloff based on thickness
            let occlusion = saturate(1.0 - depth_diff / params.thickness);
            shadow = min(shadow, 1.0 - occlusion * 0.8);
        }
    }

    // Apply distance fade
    return mix(1.0, shadow, distance_fade);
}

// Simplified contact shadow for grass (no depth texture required)
// Uses analytical ray-plane intersection with ground
fn grass_contact_shadow(
    world_position: vec3<f32>,
    blade_height: f32,          // Height of grass blade tip above ground
    sun_direction: vec3<f32>,
    shadow_length: f32,
) -> f32 {
    // Shadow from nearby blades based on height
    // Taller parts cast shadows, lower parts receive shadows
    
    // Ground plane intersection
    let ground_y = world_position.y - blade_height;
    
    // If light is steep, short shadows
    let light_slope = max(sun_direction.y, 0.1);
    let projected_shadow_length = blade_height / light_slope;
    
    // Distance-based shadow intensity
    let shadow_dist = min(projected_shadow_length, shadow_length);
    let height_factor = blade_height / shadow_length;
    
    // Shadow is stronger at base, fades toward tip
    let shadow_intensity = saturate((1.0 - height_factor) * 0.5);
    
    return 1.0 - shadow_intensity;
}

// Self-shadowing for grass blades based on blade bending
fn grass_self_shadow(
    height_factor: f32,         // 0 at base, 1 at tip
    wind_bend: f32,             // Amount of wind bending
    sun_direction: vec3<f32>,
) -> f32 {
    // Lower parts receive self-shadow from upper parts
    let base_shadow = pow(1.0 - height_factor, 2.0) * 0.3;
    
    // Wind bending can expose or hide parts
    let bend_shadow = abs(wind_bend) * (1.0 - height_factor) * 0.2;
    
    // Sun angle affects self-shadowing
    let sun_factor = max(sun_direction.y, 0.0);
    let sun_shadow = (1.0 - sun_factor) * 0.2;
    
    return 1.0 - saturate(base_shadow + bend_shadow + sun_shadow);
}

// Ambient occlusion approximation for grass fields
// Based on grass density and blade height
fn grass_ambient_occlusion(
    height_factor: f32,         // 0 at base, 1 at tip
    density_factor: f32,        // Local grass density (0-1)
) -> f32 {
    // Strong AO at grass base, fading to tip
    let height_ao = pow(1.0 - height_factor, 3.0);
    
    // Denser grass = more occlusion
    let density_ao = density_factor * 0.5;
    
    return 1.0 - saturate(height_ao * (0.5 + density_ao));
}
