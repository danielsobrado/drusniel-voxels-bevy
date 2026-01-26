//! Volumetric Clouds with Temporal Reprojection
//! 
//! Raymarched volumetric clouds using 3D noise with temporal reprojection
//! for performance. Based on Horizon Zero Dawn and Guerrilla Games techniques.

#import bevy_pbr::{
    mesh_view_bindings::view,
    forward_io::VertexOutput,
}

// Cloud parameters uniform
struct CloudParams {
    // Layer boundaries
    cloud_base_height: f32,
    cloud_top_height: f32,
    cloud_thickness: f32,
    _padding0: f32,
    
    // Density
    density_multiplier: f32,
    coverage: f32,
    cloud_type: f32, // 0 = stratus, 0.5 = stratocumulus, 1 = cumulus
    _padding1: f32,
    
    // Lighting
    sun_direction: vec3<f32>,
    _padding2: f32,
    sun_color: vec3<f32>,
    sun_intensity: f32,
    ambient_color: vec3<f32>,
    _padding3: f32,
    
    // Animation
    wind_direction: vec2<f32>,
    wind_speed: f32,
    time: f32,
    
    // Raymarching
    primary_step_count: i32,
    light_step_count: i32,
    _padding4: vec2<f32>,
    
    // Temporal
    jitter_strength: f32,
    temporal_blend: f32,
    _padding5: vec2<f32>,
    
    // Camera
    camera_position: vec3<f32>,
    _padding6: f32,
    
    // Previous frame for reprojection
    prev_view_proj: mat4x4<f32>,
}

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> cloud_params: CloudParams;
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var noise_texture: texture_3d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var detail_noise_texture: texture_3d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(3) var weather_texture: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(4) var blue_noise_texture: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(5) var cloud_sampler: sampler;
@group(#{MATERIAL_BIND_GROUP}) @binding(6) var history_texture: texture_2d<f32>;

// Constants
const PI: f32 = 3.14159265359;
const EARTH_RADIUS: f32 = 6371000.0;
const CLOUD_SCALE: f32 = 0.00003;
const DETAIL_SCALE: f32 = 0.0003;
const WEATHER_SCALE: f32 = 0.00002;

// Henyey-Greenstein phase function for anisotropic scattering
fn henyey_greenstein(cos_theta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let denom = 1.0 + g2 - 2.0 * g * cos_theta;
    return (1.0 - g2) / (4.0 * PI * pow(denom, 1.5));
}

// Dual-lobe phase function for realistic cloud scattering
fn dual_lobe_phase(cos_theta: f32) -> f32 {
    // Forward scattering lobe (silver lining effect)
    let forward = henyey_greenstein(cos_theta, 0.8);
    // Back scattering lobe (soft ambient)
    let back = henyey_greenstein(cos_theta, -0.5);
    // Blend with bias toward forward scattering
    return mix(back, forward, 0.7);
}

// Beer-Lambert law for light extinction
fn beer_lambert(optical_depth: f32) -> f32 {
    return exp(-optical_depth);
}

// Powder effect for dark edges
fn powder_effect(optical_depth: f32) -> f32 {
    return 1.0 - exp(-optical_depth * 2.0);
}

// Remap value from one range to another
fn remap(value: f32, old_min: f32, old_max: f32, new_min: f32, new_max: f32) -> f32 {
    return new_min + (value - old_min) / (old_max - old_min) * (new_max - new_min);
}

// Get height fraction within cloud layer
fn get_height_fraction(world_pos: vec3<f32>) -> f32 {
    let height = length(world_pos) - EARTH_RADIUS;
    return saturate((height - cloud_params.cloud_base_height) / cloud_params.cloud_thickness);
}

// Height-based density gradient for different cloud types
fn get_density_height_gradient(height_fraction: f32, cloud_type: f32) -> f32 {
    // Stratus: flat, low
    let stratus = remap(height_fraction, 0.0, 0.1, 0.0, 1.0) * remap(height_fraction, 0.2, 0.3, 1.0, 0.0);
    
    // Stratocumulus: medium height, more rounded
    let strato_cumulus = remap(height_fraction, 0.0, 0.2, 0.0, 1.0) * remap(height_fraction, 0.4, 0.6, 1.0, 0.0);
    
    // Cumulus: tall, puffy
    let cumulus = remap(height_fraction, 0.0, 0.1, 0.0, 1.0) * remap(height_fraction, 0.6, 0.95, 1.0, 0.0);
    
    // Interpolate between cloud types
    let a = mix(stratus, strato_cumulus, saturate(cloud_type * 2.0));
    return mix(a, cumulus, saturate(cloud_type * 2.0 - 1.0));
}

// Sample weather texture for large-scale coverage
fn sample_weather(pos: vec2<f32>) -> vec3<f32> {
    let uv = pos * WEATHER_SCALE + cloud_params.wind_direction * cloud_params.time * cloud_params.wind_speed * 0.1;
    return textureSample(weather_texture, cloud_sampler, uv).rgb;
}

// Sample base cloud shape noise
fn sample_cloud_shape(pos: vec3<f32>) -> f32 {
    let animated_pos = pos + vec3<f32>(
        cloud_params.wind_direction.x * cloud_params.time * cloud_params.wind_speed,
        0.0,
        cloud_params.wind_direction.y * cloud_params.time * cloud_params.wind_speed
    );
    
    let uvw = animated_pos * CLOUD_SCALE;
    let noise = textureSample(noise_texture, cloud_sampler, uvw);
    
    // Worley-Perlin noise combination (R = Perlin, GBA = Worley octaves)
    let perlin = noise.r;
    let worley = noise.g * 0.625 + noise.b * 0.25 + noise.a * 0.125;
    
    return remap(perlin, worley - 1.0, 1.0, 0.0, 1.0);
}

// Sample detail noise for erosion
fn sample_detail_noise(pos: vec3<f32>, height_fraction: f32) -> f32 {
    let animated_pos = pos + vec3<f32>(
        cloud_params.wind_direction.x * cloud_params.time * cloud_params.wind_speed * 0.4,
        cloud_params.time * 3.0, // Upward motion for detail
        cloud_params.wind_direction.y * cloud_params.time * cloud_params.wind_speed * 0.4
    );
    
    let uvw = animated_pos * DETAIL_SCALE;
    let noise = textureSample(detail_noise_texture, cloud_sampler, uvw);
    
    // Worley FBM
    let detail = noise.r * 0.625 + noise.g * 0.25 + noise.b * 0.125;
    
    // More erosion at top of clouds
    return detail * mix(0.4, 1.0, height_fraction);
}

// Main cloud density sampling function
fn sample_cloud_density(pos: vec3<f32>, lod: f32) -> f32 {
    let height_fraction = get_height_fraction(pos);
    
    // Outside cloud layer
    if height_fraction < 0.0 || height_fraction > 1.0 {
        return 0.0;
    }
    
    // Sample weather for coverage
    let weather = sample_weather(pos.xz);
    let coverage = weather.r * cloud_params.coverage;
    let precipitation = weather.g;
    let cloud_type = mix(cloud_params.cloud_type, weather.b, 0.5);
    
    // Height-based density gradient
    let height_gradient = get_density_height_gradient(height_fraction, cloud_type);
    
    // Sample base shape
    let base_shape = sample_cloud_shape(pos);
    
    // Apply coverage and height gradient
    var density = base_shape * height_gradient;
    density = remap(density, 1.0 - coverage, 1.0, 0.0, 1.0) * coverage;
    
    // Early exit for LOD (skip detail for distant samples)
    if lod > 0.5 || density <= 0.0 {
        return max(0.0, density) * cloud_params.density_multiplier;
    }
    
    // Add detail erosion
    let detail = sample_detail_noise(pos, height_fraction);
    density = remap(density, detail * 0.3, 1.0, 0.0, 1.0);
    
    return max(0.0, density) * cloud_params.density_multiplier;
}

// Ray-sphere intersection
fn ray_sphere_intersect(ray_origin: vec3<f32>, ray_dir: vec3<f32>, sphere_center: vec3<f32>, sphere_radius: f32) -> vec2<f32> {
    let oc = ray_origin - sphere_center;
    let a = dot(ray_dir, ray_dir);
    let b = 2.0 * dot(oc, ray_dir);
    let c = dot(oc, oc) - sphere_radius * sphere_radius;
    let discriminant = b * b - 4.0 * a * c;
    
    if discriminant < 0.0 {
        return vec2<f32>(-1.0, -1.0);
    }
    
    let sqrt_disc = sqrt(discriminant);
    return vec2<f32>(
        (-b - sqrt_disc) / (2.0 * a),
        (-b + sqrt_disc) / (2.0 * a)
    );
}

// Get cloud layer entry and exit points
fn get_cloud_ray_length(ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> vec2<f32> {
    let earth_center = vec3<f32>(0.0, -EARTH_RADIUS, 0.0);
    
    let inner_radius = EARTH_RADIUS + cloud_params.cloud_base_height;
    let outer_radius = EARTH_RADIUS + cloud_params.cloud_top_height;
    
    let inner_isect = ray_sphere_intersect(ray_origin, ray_dir, earth_center, inner_radius);
    let outer_isect = ray_sphere_intersect(ray_origin, ray_dir, earth_center, outer_radius);
    
    // Camera below cloud layer
    var start_dist = max(0.0, inner_isect.y);
    var end_dist = outer_isect.y;
    
    // Camera inside cloud layer
    let camera_height = length(ray_origin - earth_center);
    if camera_height > inner_radius && camera_height < outer_radius {
        start_dist = 0.0;
        end_dist = outer_isect.y;
    }
    
    // Camera above cloud layer
    if camera_height > outer_radius {
        start_dist = outer_isect.x;
        end_dist = inner_isect.x;
    }
    
    return vec2<f32>(start_dist, end_dist);
}

// Light marching for in-scattering
fn light_march(pos: vec3<f32>) -> f32 {
    let light_dir = normalize(cloud_params.sun_direction);
    let cloud_bounds = get_cloud_ray_length(pos, light_dir);
    
    let step_size = min((cloud_bounds.y - cloud_bounds.x) / f32(cloud_params.light_step_count), 500.0);
    
    var total_density = 0.0;
    var sample_pos = pos;
    
    for (var i = 0; i < cloud_params.light_step_count; i++) {
        sample_pos = sample_pos + light_dir * step_size;
        let density = sample_cloud_density(sample_pos, 0.7); // Use LOD for light samples
        total_density += density * step_size;
    }
    
    return total_density;
}

// Main cloud raymarching
fn raymarch_clouds(ray_origin: vec3<f32>, ray_dir: vec3<f32>, blue_noise: f32) -> vec4<f32> {
    let cloud_bounds = get_cloud_ray_length(ray_origin, ray_dir);
    
    if cloud_bounds.y < 0.0 || cloud_bounds.x > cloud_bounds.y {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    
    // Raymarching parameters
    let max_distance = min(cloud_bounds.y - cloud_bounds.x, 50000.0);
    let step_size = max_distance / f32(cloud_params.primary_step_count);
    
    // Temporal jitter using blue noise
    let jitter = blue_noise * cloud_params.jitter_strength * step_size;
    var current_dist = cloud_bounds.x + jitter;
    
    var transmittance = 1.0;
    var luminance = vec3<f32>(0.0);
    
    let light_dir = normalize(cloud_params.sun_direction);
    let cos_theta = dot(ray_dir, light_dir);
    let phase = dual_lobe_phase(cos_theta);
    
    for (var i = 0; i < cloud_params.primary_step_count; i++) {
        if transmittance < 0.01 {
            break;
        }
        
        let sample_pos = ray_origin + ray_dir * current_dist;
        let lod = saturate(f32(i) / f32(cloud_params.primary_step_count));
        let density = sample_cloud_density(sample_pos, lod);
        
        if density > 0.001 {
            // Light marching for this sample
            let light_optical_depth = light_march(sample_pos);
            let light_transmittance = beer_lambert(light_optical_depth);
            
            // Powder effect for dark cloud edges
            let powder = powder_effect(light_optical_depth);
            
            // Height-based ambient
            let height_frac = get_height_fraction(sample_pos);
            let ambient = mix(
                cloud_params.ambient_color * 0.3,
                cloud_params.ambient_color,
                height_frac
            );
            
            // Combined lighting
            let sun_light = cloud_params.sun_color * cloud_params.sun_intensity * light_transmittance * phase;
            let scattered_light = sun_light * mix(1.0, powder, 0.5) + ambient;
            
            // Accumulate
            let sample_transmittance = beer_lambert(density * step_size);
            let integration = (1.0 - sample_transmittance) * transmittance;
            
            luminance += scattered_light * integration;
            transmittance *= sample_transmittance;
        }
        
        current_dist += step_size;
        
        if current_dist > cloud_bounds.y {
            break;
        }
    }
    
    return vec4<f32>(luminance, 1.0 - transmittance);
}

// Temporal reprojection
fn temporal_reproject(current_uv: vec2<f32>, world_pos: vec3<f32>) -> vec4<f32> {
    // Reproject to previous frame
    let prev_clip = cloud_params.prev_view_proj * vec4<f32>(world_pos, 1.0);
    let prev_ndc = prev_clip.xyz / prev_clip.w;
    let prev_uv = prev_ndc.xy * 0.5 + 0.5;
    
    // Check if reprojected position is valid
    if prev_uv.x < 0.0 || prev_uv.x > 1.0 || prev_uv.y < 0.0 || prev_uv.y > 1.0 {
        return vec4<f32>(0.0);
    }
    
    // Sample history with clamping for ghosting reduction
    return textureSample(history_texture, cloud_sampler, prev_uv);
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let screen_uv = in.uv;
    let screen_size = vec2<f32>(textureDimensions(blue_noise_texture));
    
    // Get blue noise for temporal jitter
    let noise_uv = fract(screen_uv * screen_size / 64.0);
    let blue_noise = textureSample(blue_noise_texture, cloud_sampler, noise_uv).r;
    
    // Reconstruct world ray from screen position
    let ndc = vec2<f32>(screen_uv.x * 2.0 - 1.0, 1.0 - screen_uv.y * 2.0);
    let ray_origin = cloud_params.camera_position;
    
    // Calculate ray direction (would need proper inverse VP matrix in production)
    let ray_dir = normalize(vec3<f32>(ndc.x, ndc.y, 1.0));
    
    // Raymarch clouds
    var cloud_color = raymarch_clouds(ray_origin, ray_dir, blue_noise);
    
    // Temporal reprojection blend
    if cloud_params.temporal_blend > 0.0 {
        let sample_dist = (get_cloud_ray_length(ray_origin, ray_dir).x + get_cloud_ray_length(ray_origin, ray_dir).y) * 0.5;
        let world_pos = ray_origin + ray_dir * sample_dist;
        let history = temporal_reproject(screen_uv, world_pos);
        
        // Blend with history (reduces noise from jittering)
        cloud_color = mix(cloud_color, history, cloud_params.temporal_blend);
    }
    
    return cloud_color;
}

// Compute shader for cloud rendering (optional, for better performance)
// Can be used to render at lower resolution and upsample

@compute @workgroup_size(8, 8, 1)
fn compute_clouds(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(workgroup_id) workgroup_id: vec3<u32>,
) {
    // Compute implementation for tiled cloud rendering
    // This allows rendering at 1/4 resolution and upsampling
    let pixel = vec2<f32>(global_id.xy);
    // ... (full compute implementation would go here)
}
