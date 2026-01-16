// PCSS (Percentage-Closer Soft Shadows) Implementation
// Contact-hardening shadows with variable penumbra
// Based on NVIDIA's PCSS technique
//
// Features:
// - Blocker search to determine penumbra size
// - Variable filter kernel based on distance
// - Realistic soft shadow falloff
// - Optimized for real-time performance

// Shadow utilities - import from Bevy's shadow system
#import bevy_pbr::mesh_view_bindings::view
#import bevy_pbr::shadows::{sample_shadow_map, cascade_index}

struct PcssUniforms {
    light_size: f32,          // World-space light source size
    blocker_search_samples: u32, // Samples for blocker search (8-16)
    pcf_samples: u32,         // PCF filter samples (16-32)
    min_penumbra_size: f32,   // Minimum shadow blur
    max_penumbra_size: f32,   // Maximum shadow blur
    padding: vec3<f32>,
};

@group(2) @binding(10) var<uniform> pcss: PcssUniforms;
@group(2) @binding(11) var shadow_map: texture_depth_2d_array;
@group(2) @binding(12) var shadow_sampler: sampler_comparison;

const PI: f32 = 3.14159265359;

// Vogel disk sampling pattern for blocker search
fn vogel_disk_sample(sample_index: u32, sample_count: u32, phi: f32) -> vec2<f32> {
    let golden_angle = 2.4;
    let r = sqrt(f32(sample_index) + 0.5) / sqrt(f32(sample_count));
    let theta = f32(sample_index) * golden_angle + phi;
    return vec2<f32>(r * cos(theta), r * sin(theta));
}

// Find average blocker depth in light-space
fn find_blocker_depth(
    shadow_coord: vec3<f32>,
    cascade: u32,
    search_width: f32,
    receiver_depth: f32,
) -> f32 {
    var blocker_sum = 0.0;
    var blocker_count = 0.0;
    
    let sample_count = pcss.blocker_search_samples;
    
    // Rotate samples per-pixel for noise reduction
    let noise = fract(sin(dot(shadow_coord.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    let rotation = noise * 2.0 * PI;
    
    for (var i: u32 = 0u; i < sample_count; i = i + 1u) {
        let offset = vogel_disk_sample(i, sample_count, rotation) * search_width;
        let sample_uv = shadow_coord.xy + offset;
        
        // Sample shadow map depth
        let blocker_depth = textureSampleLevel(
            shadow_map,
            shadow_sampler,
            sample_uv,
            i32(cascade),
            0.0
        ).r;
        
        // Only count samples that are blocking the receiver
        if blocker_depth < receiver_depth {
            blocker_sum = blocker_sum + blocker_depth;
            blocker_count = blocker_count + 1.0;
        }
    }
    
    if blocker_count == 0.0 {
        return -1.0; // No blockers found, fully lit
    }
    
    return blocker_sum / blocker_count;
}

// Estimate penumbra width based on blocker distance
fn penumbra_size(
    receiver_depth: f32,
    blocker_depth: f32,
) -> f32 {
    // Similar triangles principle
    // penumbra = light_size * (receiver - blocker) / blocker
    let distance_ratio = (receiver_depth - blocker_depth) / blocker_depth;
    let size = pcss.light_size * distance_ratio;
    
    return clamp(size, pcss.min_penumbra_size, pcss.max_penumbra_size);
}

// Percentage-closer filtering with variable kernel size
fn pcf_filter(
    shadow_coord: vec3<f32>,
    cascade: u32,
    filter_radius: f32,
    receiver_depth: f32,
) -> f32 {
    var shadow_sum = 0.0;
    let sample_count = pcss.pcf_samples;
    
    let noise = fract(sin(dot(shadow_coord.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    let rotation = noise * 2.0 * PI;
    
    for (var i: u32 = 0u; i < sample_count; i = i + 1u) {
        let offset = vogel_disk_sample(i, sample_count, rotation) * filter_radius;
        let sample_uv = shadow_coord.xy + offset;
        
        // Compare receiver depth with shadow map
        let shadow = textureSampleCompareLevel(
            shadow_map,
            shadow_sampler,
            sample_uv,
            i32(cascade),
            receiver_depth
        );
        
        shadow_sum = shadow_sum + shadow;
    }
    
    return shadow_sum / f32(sample_count);
}

// Main PCSS function
fn pcss_shadow(
    world_position: vec3<f32>,
    normal: vec3<f32>,
) -> f32 {
    // Transform world position to light space
    // (This would use cascade transformation matrices from Bevy)
    // Simplified for demonstration:
    let cascade = 0u; // cascade_index(world_position);
    
    // Get shadow coordinates (UV + depth)
    // let shadow_coord = ... // Transform using cascade matrix
    let shadow_coord = vec3<f32>(0.5, 0.5, 0.5); // Placeholder
    let receiver_depth = shadow_coord.z;
    
    // Apply normal offset bias
    let normal_bias = 0.01;
    let biased_depth = receiver_depth - normal_bias;
    
    // Step 1: Blocker search
    let search_width = pcss.light_size / 100.0; // Normalized to shadow map space
    let blocker_depth = find_blocker_depth(shadow_coord, cascade, search_width, biased_depth);
    
    // Early out: no blockers = fully lit
    if blocker_depth < 0.0 {
        return 1.0;
    }
    
    // Step 2: Penumbra estimation
    let filter_radius = penumbra_size(biased_depth, blocker_depth);
    
    // Step 3: Percentage-closer filtering
    return pcf_filter(shadow_coord, cascade, filter_radius, biased_depth);
}

// Export function for use in PBR shader
fn calculate_pcss_shadow(world_position: vec3<f32>, normal: vec3<f32>) -> f32 {
    return pcss_shadow(world_position, normal);
}
