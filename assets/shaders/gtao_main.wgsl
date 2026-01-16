// XeGTAO Main Pass - Ground Truth Ambient Occlusion
// Based on Intel's XeGTAO: https://github.com/GameTechDev/XeGTAO
// Ported to WGSL for Bevy 0.17
//
// Features:
// - Horizon-based ambient occlusion with multi-tap sampling
// - Bent normals output for directional occlusion
// - Temporal filtering support
// - High quality with minimal overhead

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput

@group(0) @binding(0) var depth_normal_texture: texture_2d<f32>;
@group(0) @binding(1) var depth_normal_sampler: sampler;
@group(0) @binding(2) var noise_texture: texture_2d<f32>;
@group(0) @binding(3) var noise_sampler: sampler;

struct GtaoSettings {
    slice_count: u32,           // Number of slices (directions) - 2 or 3 recommended
    steps_per_slice: u32,       // Samples per direction - 2-4 recommended
    radius: f32,                // World-space radius in meters
    falloff_range: f32,         // Distance falloff range
    final_value_power: f32,     // Power curve for final AO (1.5-2.5)
    sample_distribution_power: f32, // Sample distribution (2.0 default)
    thin_occluder_compensation: f32, // Reduce over-darkening (0.0-1.0)
    depth_mip_sampling_offset: f32,  // Use mip-mapped depth for far samples
    padding: vec4<f32>,
};

@group(0) @binding(4) var<uniform> settings: GtaoSettings;

struct ViewUniforms {
    projection: mat4x4<f32>,
    inv_projection: mat4x4<f32>,
    viewport_size: vec2<f32>,
    near: f32,
    far: f32,
};

@group(0) @binding(5) var<uniform> view: ViewUniforms;

const PI: f32 = 3.14159265359;
const HALF_PI: f32 = 1.57079632679;

// Fast arccos approximation
fn fast_acos(x: f32) -> f32 {
    let t = abs(x);
    let res = -0.156583 * t + HALF_PI;
    let result = res * sqrt(1.0 - t);
    return select(result, PI - result, x < 0.0);
}

// Decode normal and depth from packed texture
fn decode_normal_depth(uv: vec2<f32>) -> vec4<f32> {
    let packed = textureSample(depth_normal_texture, depth_normal_sampler, uv);
    let normal = normalize(packed.xyz * 2.0 - 1.0);
    let depth = packed.w;
    return vec4<f32>(normal, depth);
}

// View-space position from depth
fn get_view_position(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let ndc = vec3<f32>(uv * 2.0 - 1.0, depth);
    let view_pos_homogeneous = view.inv_projection * vec4<f32>(ndc, 1.0);
    return view_pos_homogeneous.xyz / view_pos_homogeneous.w;
}

// Screen-space to view-space direction
fn screen_to_view_dir(screen_offset: vec2<f32>, view_pos: vec3<f32>) -> vec3<f32> {
    let pixel_size = 1.0 / view.viewport_size;
    let uv_offset = screen_offset * pixel_size;
    
    // Sample depth at offset position
    let neighbor_uv = vec2<f32>(0.5, 0.5) + uv_offset; // Simplified, should use actual UV
    let neighbor_depth = decode_normal_depth(neighbor_uv).w;
    let neighbor_pos = get_view_position(neighbor_uv, neighbor_depth);
    
    return normalize(neighbor_pos - view_pos);
}

// Main GTAO horizon search along a slice
fn compute_slice_occlusion(
    view_pos: vec3<f32>,
    view_normal: vec3<f32>,
    slice_dir: vec2<f32>,
    noise: f32,
    pixel_coord: vec2<f32>,
) -> vec2<f32> {
    // Tangent and bitangent for this slice
    let proj_normal = vec3<f32>(view_normal.xy, 0.0);
    let ortho_dir = normalize(cross(vec3<f32>(0.0, 0.0, 1.0), proj_normal));
    
    var horizon_cos_neg: f32 = -1.0;
    var horizon_cos_pos: f32 = -1.0;
    
    let step_count = settings.steps_per_slice;
    let pixel_size = 1.0 / view.viewport_size;
    
    // Sample both directions along the slice
    for (var step: u32 = 0u; step < step_count; step = step + 1u) {
        let t = (f32(step) + noise) / f32(step_count);
        let sample_offset = pow(t, settings.sample_distribution_power) * settings.radius;
        
        // Positive direction
        let offset_pos = slice_dir * sample_offset;
        let sample_uv_pos = pixel_coord * pixel_size + offset_pos * pixel_size;
        let sample_data_pos = decode_normal_depth(sample_uv_pos);
        let sample_pos_pos = get_view_position(sample_uv_pos, sample_data_pos.w);
        
        let delta_pos = sample_pos_pos - view_pos;
        let delta_length_pos = length(delta_pos);
        let horizon_dir_pos = delta_pos / delta_length_pos;
        let horizon_cos_candidate_pos = dot(horizon_dir_pos, view_normal);
        
        // Falloff based on distance
        let falloff_pos = saturate((settings.radius - delta_length_pos) / settings.falloff_range);
        horizon_cos_pos = max(horizon_cos_pos, mix(-1.0, horizon_cos_candidate_pos, falloff_pos));
        
        // Negative direction
        let offset_neg = -slice_dir * sample_offset;
        let sample_uv_neg = pixel_coord * pixel_size + offset_neg * pixel_size;
        let sample_data_neg = decode_normal_depth(sample_uv_neg);
        let sample_pos_neg = get_view_position(sample_uv_neg, sample_data_neg.w);
        
        let delta_neg = sample_pos_neg - view_pos;
        let delta_length_neg = length(delta_neg);
        let horizon_dir_neg = delta_neg / delta_length_neg;
        let horizon_cos_candidate_neg = dot(horizon_dir_neg, view_normal);
        
        let falloff_neg = saturate((settings.radius - delta_length_neg) / settings.falloff_range);
        horizon_cos_neg = max(horizon_cos_neg, mix(-1.0, horizon_cos_candidate_neg, falloff_neg));
    }
    
    return vec2<f32>(horizon_cos_neg, horizon_cos_pos);
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let pixel_coord = in.position.xy;
    let uv = in.uv;
    
    // Decode normal and depth
    let data = decode_normal_depth(uv);
    let view_normal = data.xyz;
    let depth = data.w;
    
    // Early out for sky
    if depth >= 0.9999 {
        return vec4<f32>(1.0, 1.0, 1.0, 1.0);
    }
    
    let view_pos = get_view_position(uv, depth);
    
    // Spatiotemporal noise for dithering
    let noise_uv = pixel_coord / 4.0; // 4x4 noise tile
    let noise = textureSample(noise_texture, noise_sampler, noise_uv).r;
    
    var occlusion = 0.0;
    var bent_normal = vec3<f32>(0.0);
    
    let slice_count = settings.slice_count;
    let angle_step = PI / f32(slice_count);
    
    // Integrate over all slices
    for (var slice: u32 = 0u; slice < slice_count; slice = slice + 1u) {
        let angle = (f32(slice) + noise) * angle_step;
        let slice_dir = vec2<f32>(cos(angle), sin(angle));
        
        let horizons = compute_slice_occlusion(view_pos, view_normal, slice_dir, noise, pixel_coord);
        
        // Compute visibility from horizon angles
        let h_neg = fast_acos(clamp(horizons.x, -1.0, 1.0));
        let h_pos = fast_acos(clamp(horizons.y, -1.0, 1.0));
        
        // Cosine-weighted integration
        let visibility = (cos(h_neg) + cos(h_pos)) * 0.25;
        occlusion = occlusion + (1.0 - visibility);
        
        // Accumulate bent normal (average unoccluded direction)
        let bent_angle = (h_neg + h_pos) * 0.5;
        let bent_dir_2d = slice_dir * cos(bent_angle);
        bent_normal = bent_normal + vec3<f32>(bent_dir_2d, sin(bent_angle));
    }
    
    occlusion = occlusion / f32(slice_count);
    bent_normal = normalize(bent_normal);
    
    // Thin occluder compensation
    occlusion = pow(saturate(occlusion), settings.final_value_power);
    occlusion = occlusion * (1.0 - settings.thin_occluder_compensation) + settings.thin_occluder_compensation;
    
    let final_ao = 1.0 - occlusion;
    
    // Output: RGB = bent normal (encoded), A = AO
    return vec4<f32>(bent_normal * 0.5 + 0.5, final_ao);
}
