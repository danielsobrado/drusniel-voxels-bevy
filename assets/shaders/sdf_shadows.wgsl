// SDF Terrain Shadows - Enshrouded-style distance field shadows for terrain
// Leverages voxel SDF for efficient soft shadows on large-scale geometry
//
// Features:
// - Sphere tracing through SDF volume for soft shadows
// - Cone-based penumbra estimation for natural shadow falloff
// - Distance-scaled shadow softness (closer = sharper)
// - Optimized for real-time with early termination

#define_import_path sdf_shadows

// SDF volume data
struct SdfVolumeData {
    volume_min: vec3<f32>,
    _padding0: f32,
    volume_max: vec3<f32>,
    _padding1: f32,
    resolution: vec3<u32>,
    _padding2: u32,
};

struct SdfShadowParams {
    max_steps: u32,           // Maximum marching steps (16-64)
    max_distance: f32,        // Maximum shadow ray distance
    soft_shadow_k: f32,       // Penumbra hardness (higher = sharper)
    bias: f32,                // Starting offset to prevent self-shadow
    min_penumbra: f32,        // Minimum shadow softness
    max_penumbra: f32,        // Maximum shadow softness
    _padding: vec2<f32>,
    sun_direction: vec3<f32>, // Toward light
    sun_size: f32,            // Angular size for penumbra calculation
};

// Sample SDF volume at world position
// Returns signed distance (negative = inside solid)
fn sample_sdf(
    world_pos: vec3<f32>,
    sdf_texture: texture_3d<f32>,
    sdf_sampler: sampler,
    volume_data: SdfVolumeData,
) -> f32 {
    let volume_size = volume_data.volume_max - volume_data.volume_min;
    let uvw = (world_pos - volume_data.volume_min) / volume_size;
    
    // Out of bounds check
    if any(uvw < vec3<f32>(0.0)) || any(uvw > vec3<f32>(1.0)) {
        return 1000.0; // Far away, no occlusion
    }
    
    // Trilinear sampling of SDF
    // Scale distance by voxel size for correct world-space values
    let voxel_size = volume_size / vec3<f32>(volume_data.resolution);
    let avg_voxel = (voxel_size.x + voxel_size.y + voxel_size.z) / 3.0;
    
    return textureSample(sdf_texture, sdf_sampler, uvw).r * avg_voxel;
}

// Soft shadows using SDF sphere tracing with cone estimation
// Based on Inigo Quilez's soft shadow technique
fn sdf_soft_shadow(
    origin: vec3<f32>,
    direction: vec3<f32>,          // Normalized direction toward light
    sdf_texture: texture_3d<f32>,
    sdf_sampler: sampler,
    volume_data: SdfVolumeData,
    params: SdfShadowParams,
) -> f32 {
    var shadow = 1.0;
    var t = params.bias;
    var prev_dist = 1e10;
    
    // Calculate voxel size for step scaling
    let volume_size = volume_data.volume_max - volume_data.volume_min;
    let voxel_size = volume_size / vec3<f32>(volume_data.resolution);
    let min_step = min(min(voxel_size.x, voxel_size.y), voxel_size.z) * 0.5;
    
    for (var i = 0u; i < params.max_steps; i++) {
        let pos = origin + direction * t;
        
        // Check bounds
        if t > params.max_distance {
            break;
        }
        
        let dist = sample_sdf(pos, sdf_texture, sdf_sampler, volume_data);
        
        // Hit solid - full shadow
        if dist < 0.001 {
            return 0.0;
        }
        
        // Improved penumbra estimation
        // Uses intersection of cones for smoother transitions
        let y = dist * dist / (2.0 * prev_dist);
        let d = sqrt(dist * dist - y * y);
        shadow = min(shadow, params.soft_shadow_k * d / max(0.0, t - y));
        
        prev_dist = dist;
        
        // Step by safe distance (sphere tracing)
        t += max(dist * 0.9, min_step);
        
        // Early termination if almost fully shadowed
        if shadow < 0.01 {
            return 0.0;
        }
    }
    
    return clamp(shadow, 0.0, 1.0);
}

// Hard shadow variant for performance
fn sdf_hard_shadow(
    origin: vec3<f32>,
    direction: vec3<f32>,
    sdf_texture: texture_3d<f32>,
    sdf_sampler: sampler,
    volume_data: SdfVolumeData,
    params: SdfShadowParams,
) -> f32 {
    var t = params.bias;
    
    let volume_size = volume_data.volume_max - volume_data.volume_min;
    let voxel_size = volume_size / vec3<f32>(volume_data.resolution);
    let min_step = min(min(voxel_size.x, voxel_size.y), voxel_size.z);
    
    for (var i = 0u; i < params.max_steps; i++) {
        let pos = origin + direction * t;
        
        if t > params.max_distance {
            return 1.0;
        }
        
        let dist = sample_sdf(pos, sdf_texture, sdf_sampler, volume_data);
        
        if dist < 0.0 {
            return 0.0;
        }
        
        t += max(dist, min_step);
    }
    
    return 1.0;
}

// Terrain shadow with distance-based softness
// Shadows get softer with distance from receiver
fn sdf_terrain_shadow(
    world_position: vec3<f32>,
    world_normal: vec3<f32>,
    sdf_texture: texture_3d<f32>,
    sdf_sampler: sampler,
    volume_data: SdfVolumeData,
    params: SdfShadowParams,
) -> f32 {
    // Early out for surfaces facing away from light
    let n_dot_l = dot(world_normal, params.sun_direction);
    if n_dot_l < 0.0 {
        return 0.1; // Minimal shadow for backfaces
    }
    
    // Normal offset to prevent self-shadowing on slopes
    let bias_offset = world_normal * params.bias;
    let ray_origin = world_position + bias_offset;
    
    // Compute shadow
    let shadow = sdf_soft_shadow(
        ray_origin,
        params.sun_direction,
        sdf_texture,
        sdf_sampler,
        volume_data,
        params,
    );
    
    // Combine with N.L for natural falloff
    let diffuse_factor = saturate(n_dot_l);
    
    return shadow * 0.9 + 0.1; // Minimum light to prevent pure black
}

// Combined shadow for vegetation: SDF for large shadows, contact for detail
fn vegetation_combined_shadow(
    world_position: vec3<f32>,
    world_normal: vec3<f32>,
    sdf_shadow: f32,
    contact_shadow: f32,
    vegetation_ao: f32,
) -> f32 {
    // SDF shadows provide large-scale occlusion (terrain, buildings)
    // Contact shadows add micro-detail (blade-to-blade)
    // Vegetation AO adds ground-level darkening
    
    let combined = sdf_shadow * contact_shadow * vegetation_ao;
    
    // Prevent over-darkening
    return max(combined, 0.05);
}

// Ambient occlusion from SDF (cone tracing approximation)
fn sdf_ambient_occlusion(
    world_position: vec3<f32>,
    world_normal: vec3<f32>,
    sdf_texture: texture_3d<f32>,
    sdf_sampler: sampler,
    volume_data: SdfVolumeData,
    ao_distance: f32,
    ao_steps: u32,
) -> f32 {
    var occlusion = 0.0;
    var weight_sum = 0.0;
    
    for (var i = 1u; i <= ao_steps; i++) {
        let t = ao_distance * f32(i) / f32(ao_steps);
        let sample_pos = world_position + world_normal * t;
        
        let dist = sample_sdf(sample_pos, sdf_texture, sdf_sampler, volume_data);
        
        // Expected distance vs actual
        let expected = t;
        let diff = max(expected - dist, 0.0);
        
        // Weight decreases with distance
        let weight = 1.0 / f32(i * i);
        occlusion += diff / expected * weight;
        weight_sum += weight;
    }
    
    occlusion /= weight_sum;
    return 1.0 - saturate(occlusion);
}
