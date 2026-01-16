// XeGTAO Temporal Denoise - Edge-aware spatial-temporal filter
// Reduces noise while preserving detail

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput

@group(0) @binding(0) var current_ao_texture: texture_2d<f32>;
@group(0) @binding(1) var current_ao_sampler: sampler;
@group(0) @binding(2) var history_ao_texture: texture_2d<f32>;
@group(0) @binding(3) var history_ao_sampler: sampler;
@group(0) @binding(4) var depth_texture: texture_2d<f32>;
@group(0) @binding(5) var depth_sampler: sampler;

struct DenoiseSettings {
    spatial_radius: u32,
    spatial_sigma: f32,
    temporal_blend: f32,
    depth_threshold: f32,
    normal_threshold: f32,
    padding: vec3<f32>,
};

@group(0) @binding(6) var<uniform> settings: DenoiseSettings;

// Edge-aware bilateral filter
fn spatial_filter(uv: vec2<f32>, center_depth: f32, center_normal: vec3<f32>) -> vec4<f32> {
    let pixel_size = 1.0 / vec2<f32>(textureDimensions(current_ao_texture));
    
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    
    let radius = i32(settings.spatial_radius);
    
    for (var y: i32 = -radius; y <= radius; y = y + 1) {
        for (var x: i32 = -radius; x <= radius; x = x + 1) {
            let offset = vec2<f32>(f32(x), f32(y));
            let sample_uv = uv + offset * pixel_size;
            
            // Sample AO and depth
            let sample_ao = textureSample(current_ao_texture, current_ao_sampler, sample_uv);
            let sample_depth = textureSample(depth_texture, depth_sampler, sample_uv).r;
            let sample_normal = sample_ao.xyz * 2.0 - 1.0;
            
            // Depth weight
            let depth_diff = abs(sample_depth - center_depth);
            let depth_weight = exp(-depth_diff / settings.depth_threshold);
            
            // Normal weight
            let normal_diff = 1.0 - dot(sample_normal, center_normal);
            let normal_weight = exp(-normal_diff / settings.normal_threshold);
            
            // Spatial weight (Gaussian)
            let spatial_dist = length(offset);
            let spatial_weight = exp(-spatial_dist * spatial_dist / (2.0 * settings.spatial_sigma * settings.spatial_sigma));
            
            let final_weight = depth_weight * normal_weight * spatial_weight;
            
            sum = sum + sample_ao * final_weight;
            weight_sum = weight_sum + final_weight;
        }
    }
    
    return sum / max(weight_sum, 0.0001);
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;
    
    // Current frame AO
    let current_ao = textureSample(current_ao_texture, current_ao_sampler, uv);
    let center_depth = textureSample(depth_texture, depth_sampler, uv).r;
    let center_normal = current_ao.xyz * 2.0 - 1.0;
    
    // Spatial filter
    let filtered_current = spatial_filter(uv, center_depth, center_normal);
    
    // Temporal filter (blend with history)
    let history_ao = textureSample(history_ao_texture, history_ao_sampler, uv);
    
    // Simple temporal blend (can be enhanced with motion vectors)
    let final_ao = mix(filtered_current, history_ao, settings.temporal_blend);
    
    return final_ao;
}
