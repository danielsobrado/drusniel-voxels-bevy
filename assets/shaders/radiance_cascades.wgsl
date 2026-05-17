#define_import_path radiance_cascades

//! Radiance Cascades Global Illumination Shader
//!
//! Implements screen-space radiance cascades using voxel SDF data
//! for efficient, high-quality global illumination.
//! Based on the Radiance Cascades technique by Alexander Sannikov.

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput
#import "shaders/naadf/ray_trace.wgsl" NaadfRay
#import "shaders/naadf/world_trace.wgsl" naadf_world_surface_normal, trace_naadf_world
#import "shaders/naadf/lighting_queries.wgsl" naadf_sun_visibility_world, naadf_terrain_ao_visibility_world, naadf_contact_shadow_visibility_world

// ============================================================================
// Uniforms
// ============================================================================

struct RadianceCascadeParams {
    // Cascade configuration
    cascade_count: u32,
    rays_per_probe: u32,
    probe_spacing: f32,
    max_ray_distance: f32,
    
    // SDF volume bounds
    sdf_volume_min: vec3<f32>,
    _padding0: f32,
    sdf_volume_max: vec3<f32>,
    _padding1: f32,
    sdf_volume_resolution: vec3<u32>,
    _padding2: u32,
    
    // Lighting
    sun_direction: vec3<f32>,
    _padding3: f32,
    sun_color: vec3<f32>,
    sun_intensity: f32,
    sky_color: vec3<f32>,
    sky_intensity: f32,
    
    // GI settings
    gi_intensity: f32,
    bounce_intensity: f32,
    ambient_occlusion_strength: f32,
    normal_bias: f32,
    
    // Temporal
    frame_index: u32,
    temporal_blend: f32,
    voxel_backend: u32,
    backend_switch_generation: u32,
    
    // Camera
    camera_position: vec3<f32>,
    voxel_backend_query_mask: u32,
    naadf_counts: vec4<u32>,
    inv_view_proj: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> params: RadianceCascadeParams;
@group(0) @binding(1) var sdf_volume: texture_3d<f32>;
@group(0) @binding(2) var sdf_sampler: sampler;
@group(0) @binding(3) var gbuffer_depth: texture_depth_2d;
@group(0) @binding(4) var gbuffer_normal: texture_2d<f32>;
@group(0) @binding(5) var gbuffer_albedo: texture_2d<f32>;
@group(0) @binding(6) var radiance_cascade_0: texture_2d<f32>;  // Finest cascade
@group(0) @binding(7) var radiance_cascade_1: texture_2d<f32>;
@group(0) @binding(8) var radiance_cascade_2: texture_2d<f32>;
@group(0) @binding(9) var radiance_cascade_3: texture_2d<f32>;  // Coarsest cascade
@group(0) @binding(10) var history_texture: texture_2d<f32>;
@group(0) @binding(11) var blue_noise: texture_2d<f32>;
@group(0) @binding(12) var linear_sampler: sampler;

// NAADF record buffers are declared by the imported world trace module at
// @group(3). Phase 2 binds those buffers for the cascade pipeline; query
// behavior stays on the SDF path until the per-query phases replace it.

// ============================================================================
// Constants
// ============================================================================

const PI: f32 = 3.14159265359;
const TWO_PI: f32 = 6.28318530718;
const HALF_PI: f32 = 1.57079632679;
const INV_PI: f32 = 0.31830988618;

const MAX_STEPS: u32 = 64u;
const SDF_EPSILON: f32 = 0.001;
const RAY_EPSILON: f32 = 0.01;
const GI_BACKEND_CURRENT_SDF: u32 = 0u;
const GI_BACKEND_NAADF: u32 = 1u;
const NAADF_QUERY_GI_SECONDARY: u32 = 1u;
const NAADF_QUERY_SUN_VISIBILITY: u32 = 2u;
const NAADF_QUERY_TERRAIN_AO: u32 = 4u;
const NAADF_QUERY_CONTACT_SHADOW: u32 = 8u;
const NAADF_CONTACT_SHADOW_DISTANCE: f32 = 3.0;
const NAADF_TERRAIN_AO_DISTANCE: f32 = 2.5;
const NAADF_SHORT_RANGE_STEPS: u32 = 24u;
const NAADF_GI_SECONDARY_SAMPLES: u32 = 2u;

// Cascade intervals (each cascade covers 4x the area of the previous)
const CASCADE_SCALE: f32 = 4.0;

// ============================================================================
// SDF Functions
// ============================================================================

/// Convert world position to SDF volume UVW coordinates
fn world_to_sdf_uvw(world_pos: vec3<f32>) -> vec3<f32> {
    let volume_size = params.sdf_volume_max - params.sdf_volume_min;
    return (world_pos - params.sdf_volume_min) / volume_size;
}

/// Sample SDF at world position
fn sample_sdf(world_pos: vec3<f32>) -> f32 {
    let uvw = world_to_sdf_uvw(world_pos);
    
    // Check bounds
    if any(uvw < vec3<f32>(0.0)) || any(uvw > vec3<f32>(1.0)) {
        return 1000.0; // Far outside volume
    }
    
    return textureSampleLevel(sdf_volume, sdf_sampler, uvw, 0.0).r;
}

/// Sample SDF with trilinear interpolation for smooth gradients
fn sample_sdf_smooth(world_pos: vec3<f32>) -> f32 {
    let uvw = world_to_sdf_uvw(world_pos);
    
    if any(uvw < vec3<f32>(0.0)) || any(uvw > vec3<f32>(1.0)) {
        return 1000.0;
    }
    
    // Use hardware trilinear filtering
    return textureSampleLevel(sdf_volume, linear_sampler, uvw, 0.0).r;
}

/// Calculate SDF gradient (normal) at position
fn sdf_gradient(world_pos: vec3<f32>) -> vec3<f32> {
    let eps = 0.1;
    let dx = sample_sdf(world_pos + vec3<f32>(eps, 0.0, 0.0)) - sample_sdf(world_pos - vec3<f32>(eps, 0.0, 0.0));
    let dy = sample_sdf(world_pos + vec3<f32>(0.0, eps, 0.0)) - sample_sdf(world_pos - vec3<f32>(0.0, eps, 0.0));
    let dz = sample_sdf(world_pos + vec3<f32>(0.0, 0.0, eps)) - sample_sdf(world_pos - vec3<f32>(0.0, 0.0, eps));
    return normalize(vec3<f32>(dx, dy, dz));
}

// ============================================================================
// Ray Marching
// ============================================================================

struct RayHit {
    hit: bool,
    position: vec3<f32>,
    normal: vec3<f32>,
    distance: f32,
    steps: u32,
}

/// Sphere trace through SDF volume
fn sphere_trace(origin: vec3<f32>, direction: vec3<f32>, max_dist: f32) -> RayHit {
    var result: RayHit;
    result.hit = false;
    result.distance = 0.0;
    result.steps = 0u;
    
    var t = RAY_EPSILON;
    
    for (var i = 0u; i < MAX_STEPS; i++) {
        result.steps = i;
        let pos = origin + direction * t;
        let d = sample_sdf_smooth(pos);
        
        if d < SDF_EPSILON {
            result.hit = true;
            result.position = pos;
            result.normal = sdf_gradient(pos);
            result.distance = t;
            return result;
        }
        
        t += max(d, 0.01); // Minimum step to prevent getting stuck
        
        if t > max_dist {
            break;
        }
    }
    
    result.distance = t;
    return result;
}

fn trace_current_sdf_gi(origin: vec3<f32>, direction: vec3<f32>, max_dist: f32) -> RayHit {
    return sphere_trace(origin, direction, max_dist);
}

fn trace_naadf_gi(origin: vec3<f32>, direction: vec3<f32>, max_dist: f32) -> RayHit {
    let ray = NaadfRay(origin, normalize(direction), max_dist, 1u);
    let naadf_hit = trace_naadf_world(
        ray,
        MAX_STEPS,
        naadf_chunk_count(),
        naadf_chunk_lookup_count(),
    );

    var result: RayHit;
    result.hit = naadf_hit.hit != 0u;
    result.distance = select(max_dist, naadf_hit.distance, result.hit);
    result.position = origin + normalize(direction) * result.distance;
    result.normal = select(
        vec3<f32>(0.0),
        naadf_world_surface_normal(naadf_hit, naadf_chunk_count(), naadf_chunk_lookup_count()),
        result.hit,
    );
    result.steps = naadf_hit.steps;
    return result;
}

fn use_naadf_for_query(query_mask: u32) -> bool {
    return params.voxel_backend == GI_BACKEND_NAADF &&
        (params.voxel_backend_query_mask & query_mask) != 0u;
}

fn naadf_chunk_count() -> u32 {
    return params.naadf_counts.x;
}

fn naadf_chunk_lookup_count() -> u32 {
    return params.naadf_counts.y;
}

fn trace_gi_backend(origin: vec3<f32>, direction: vec3<f32>, max_dist: f32, query_mask: u32) -> RayHit {
    if use_naadf_for_query(query_mask) {
        return trace_naadf_gi(origin, direction, max_dist);
    }
    return trace_current_sdf_gi(origin, direction, max_dist);
}

/// Soft shadow using SDF (penumbra estimation)
fn soft_shadow_sdf(origin: vec3<f32>, direction: vec3<f32>, max_dist: f32, k: f32) -> f32 {
    var shadow = 1.0;
    var t = RAY_EPSILON * 10.0;
    
    for (var i = 0u; i < 32u; i++) {
        let pos = origin + direction * t;
        let d = sample_sdf_smooth(pos);
        
        if d < SDF_EPSILON {
            return 0.0;
        }
        
        // Soft shadow factor based on distance to nearest surface
        shadow = min(shadow, k * d / t);
        t += d;
        
        if t > max_dist {
            break;
        }
    }
    
    return saturate(shadow);
}

fn soft_shadow_backend(origin: vec3<f32>, direction: vec3<f32>, max_dist: f32, k: f32) -> f32 {
    if use_naadf_for_query(NAADF_QUERY_SUN_VISIBILITY) {
        return naadf_sun_visibility_world(
            origin,
            direction,
            max_dist,
            MAX_STEPS,
            naadf_chunk_count(),
            naadf_chunk_lookup_count(),
        );
    }
    return soft_shadow_sdf(origin, direction, max_dist, k);
}

fn terrain_ao_sdf(world_pos: vec3<f32>) -> f32 {
    return saturate(sample_sdf_smooth(world_pos) * 2.0 + 0.5);
}

fn terrain_ao_backend(world_pos: vec3<f32>, normal: vec3<f32>) -> f32 {
    if use_naadf_for_query(NAADF_QUERY_TERRAIN_AO) {
        let n = normalize(normal);
        let tangent_seed = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(n.y) > 0.8);
        let tangent = normalize(cross(tangent_seed, n));
        let bitangent = normalize(cross(n, tangent));
        let origin = world_pos + n * params.normal_bias;
        var visibility = 0.0;

        visibility += naadf_terrain_ao_visibility_world(
            origin,
            n,
            NAADF_TERRAIN_AO_DISTANCE,
            NAADF_SHORT_RANGE_STEPS,
            naadf_chunk_count(),
            naadf_chunk_lookup_count(),
        );
        visibility += naadf_terrain_ao_visibility_world(
            origin,
            normalize(n + tangent * 0.75),
            NAADF_TERRAIN_AO_DISTANCE,
            NAADF_SHORT_RANGE_STEPS,
            naadf_chunk_count(),
            naadf_chunk_lookup_count(),
        );
        visibility += naadf_terrain_ao_visibility_world(
            origin,
            normalize(n - tangent * 0.75),
            NAADF_TERRAIN_AO_DISTANCE,
            NAADF_SHORT_RANGE_STEPS,
            naadf_chunk_count(),
            naadf_chunk_lookup_count(),
        );
        visibility += naadf_terrain_ao_visibility_world(
            origin,
            normalize(n + bitangent * 0.75),
            NAADF_TERRAIN_AO_DISTANCE,
            NAADF_SHORT_RANGE_STEPS,
            naadf_chunk_count(),
            naadf_chunk_lookup_count(),
        );

        return saturate(visibility * 0.25);
    }
    return terrain_ao_sdf(world_pos);
}

fn contact_shadow_sdf(origin: vec3<f32>, light_direction: vec3<f32>) -> f32 {
    return soft_shadow_sdf(origin, light_direction, NAADF_CONTACT_SHADOW_DISTANCE, 8.0);
}

fn contact_shadow_backend(world_pos: vec3<f32>, normal: vec3<f32>, light_direction: vec3<f32>) -> f32 {
    let n = normalize(normal);
    let origin = world_pos + n * params.normal_bias;
    if use_naadf_for_query(NAADF_QUERY_CONTACT_SHADOW) {
        return naadf_contact_shadow_visibility_world(
            origin,
            light_direction,
            NAADF_CONTACT_SHADOW_DISTANCE,
            NAADF_SHORT_RANGE_STEPS,
            naadf_chunk_count(),
            naadf_chunk_lookup_count(),
        );
    }
    return contact_shadow_sdf(origin, light_direction);
}

// ============================================================================
// Radiance Cascade Helpers
// ============================================================================

/// Generate ray direction from cascade probe using golden ratio spiral
fn get_ray_direction(ray_index: u32, total_rays: u32, random_offset: f32) -> vec3<f32> {
    let golden_ratio = 1.618033988749895;
    let i = f32(ray_index) + random_offset;
    
    // Fibonacci sphere distribution
    let theta = TWO_PI * i / golden_ratio;
    let phi = acos(1.0 - 2.0 * (i + 0.5) / f32(total_rays));
    
    return vec3<f32>(
        sin(phi) * cos(theta),
        sin(phi) * sin(theta),
        cos(phi)
    );
}

/// Get cascade probe position
fn get_probe_position(cascade_level: u32, probe_index: vec2<u32>, screen_size: vec2<f32>) -> vec2<f32> {
    let cascade_spacing = params.probe_spacing * pow(CASCADE_SCALE, f32(cascade_level));
    return vec2<f32>(probe_index) * cascade_spacing;
}

fn uv_to_ndc(uv: vec2<f32>) -> vec2<f32> {
    return uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0);
}

fn is_sky_depth(depth: f32) -> bool {
    return depth <= 0.001;
}

/// Reconstruct world position from depth
fn reconstruct_world_position(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let ndc = vec4<f32>(uv_to_ndc(uv), depth, 1.0);
    let world_h = params.inv_view_proj * ndc;
    return world_h.xyz / world_h.w;
}

fn depth_at_uv(uv: vec2<f32>) -> f32 {
    let dims = vec2<i32>(textureDimensions(gbuffer_depth));
    let pixel = clamp(vec2<i32>(uv * vec2<f32>(dims)), vec2<i32>(0), dims - vec2<i32>(1));
    return textureLoad(gbuffer_depth, pixel, 0);
}

// ============================================================================
// Radiance Sampling
// ============================================================================

/// Sample sky radiance for escaped rays
fn sample_sky_radiance(direction: vec3<f32>) -> vec3<f32> {
    let sun_dot = max(dot(direction, params.sun_direction), 0.0);
    
    // Sky gradient
    let horizon_color = params.sky_color * 0.7;
    let zenith_color = params.sky_color;
    let sky = mix(horizon_color, zenith_color, saturate(direction.y));
    
    // Sun contribution
    let sun_disk = smoothstep(0.9995, 0.9999, sun_dot);
    let sun = params.sun_color * params.sun_intensity * sun_disk;
    
    // Atmospheric scattering approximation
    let scatter = pow(max(sun_dot, 0.0), 8.0) * params.sun_color * 0.2;
    
    return sky * params.sky_intensity + sun + scatter;
}

/// Compute direct lighting at a point
fn compute_direct_lighting(pos: vec3<f32>, normal: vec3<f32>, albedo: vec3<f32>) -> vec3<f32> {
    let n_dot_l = max(dot(normal, params.sun_direction), 0.0);
    
    // Shadow ray
    let shadow = soft_shadow_backend(pos + normal * params.normal_bias, params.sun_direction, 100.0, 16.0);
    
    // Direct sun
    let direct = params.sun_color * params.sun_intensity * n_dot_l * shadow;
    
    return albedo * direct;
}

fn radiance_secondary_gi(world_pos: vec3<f32>, normal: vec3<f32>, albedo: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    if !use_naadf_for_query(NAADF_QUERY_GI_SECONDARY) {
        return vec3<f32>(0.0);
    }

    let screen_size = vec2<f32>(textureDimensions(gbuffer_depth));
    let pixel = floor(uv * screen_size);
    let jitter = fract(
        dot(pixel, vec2<f32>(0.06711056, 0.00583715)) +
        f32(params.frame_index) * 0.61803398875
    );
    let origin = world_pos + normal * params.normal_bias;
    var total = vec3<f32>(0.0);
    var weight_sum = 0.0;

    for (var i = 0u; i < NAADF_GI_SECONDARY_SAMPLES; i = i + 1u) {
        let dir = get_ray_direction(i, NAADF_GI_SECONDARY_SAMPLES, jitter);
        let hemisphere_dir = normalize(dir + normal);
        let n_dot_d = max(dot(hemisphere_dir, normal), 0.0);
        if n_dot_d > 0.0 {
            total += trace_probe_ray(origin, hemisphere_dir, 0u) * n_dot_d;
            weight_sum += n_dot_d;
        }
    }

    if weight_sum <= 0.0 {
        return vec3<f32>(0.0);
    }

    return total / weight_sum * albedo * params.bounce_intensity;
}

// ============================================================================
// Cascade Merging
// ============================================================================

/// Bilinear interpolation between cascade probes
fn sample_cascade(cascade_texture: texture_2d<f32>, uv: vec2<f32>) -> vec3<f32> {
    return textureSampleLevel(cascade_texture, linear_sampler, uv, 0.0).rgb;
}

/// Merge cascades from coarse to fine
fn merge_cascades(screen_uv: vec2<f32>, world_pos: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
    var radiance = vec3<f32>(0.0);
    var weight_sum = 0.0;
    
    // Sample each cascade and blend
    // Coarsest cascade provides long-range indirect light
    let c3 = sample_cascade(radiance_cascade_3, screen_uv);
    radiance += c3 * 0.1;
    weight_sum += 0.1;
    
    let c2 = sample_cascade(radiance_cascade_2, screen_uv);
    radiance += c2 * 0.2;
    weight_sum += 0.2;
    
    let c1 = sample_cascade(radiance_cascade_1, screen_uv);
    radiance += c1 * 0.3;
    weight_sum += 0.3;
    
    // Finest cascade provides local detail
    let c0 = sample_cascade(radiance_cascade_0, screen_uv);
    radiance += c0 * 0.4;
    weight_sum += 0.4;
    
    return radiance / weight_sum;
}

// ============================================================================
// Main Radiance Cascade Computation
// ============================================================================

/// Trace radiance for a single probe ray
fn trace_probe_ray(
    origin: vec3<f32>,
    direction: vec3<f32>,
    cascade_level: u32
) -> vec3<f32> {
    let max_dist = params.max_ray_distance * pow(CASCADE_SCALE, f32(cascade_level));
    
    let hit = trace_gi_backend(origin, direction, max_dist, NAADF_QUERY_GI_SECONDARY);
    
    if hit.hit {
        // Hit geometry - compute lighting at hit point
        // For now, assume neutral albedo at hit points
        let hit_albedo = vec3<f32>(0.5);
        
        // Direct lighting at hit
        let direct = compute_direct_lighting(hit.position, hit.normal, hit_albedo);
        
        // Distance-based attenuation
        let atten = 1.0 / (1.0 + hit.distance * hit.distance * 0.01);
        
        return direct * atten;
    } else {
        // Escaped to sky
        return sample_sky_radiance(direction);
    }
}

/// Compute radiance for a cascade probe
fn compute_probe_radiance(
    probe_world_pos: vec3<f32>,
    surface_normal: vec3<f32>,
    cascade_level: u32,
    random_seed: f32
) -> vec3<f32> {
    var total_radiance = vec3<f32>(0.0);
    var valid_samples = 0.0;
    
    let rays = params.rays_per_probe;
    
    for (var i = 0u; i < rays; i++) {
        let dir = get_ray_direction(i, rays, random_seed);
        
        // Hemisphere sampling - only rays in normal direction
        let hemisphere_dir = normalize(dir + surface_normal);
        let n_dot_d = dot(hemisphere_dir, surface_normal);
        
        if n_dot_d > 0.0 {
            let offset_origin = probe_world_pos + surface_normal * params.normal_bias;
            let radiance = trace_probe_ray(offset_origin, hemisphere_dir, cascade_level);
            
            // Cosine-weighted integration
            total_radiance += radiance * n_dot_d;
            valid_samples += n_dot_d;
        }
    }
    
    if valid_samples > 0.0 {
        return total_radiance / valid_samples;
    }
    
    return vec3<f32>(0.0);
}

// ============================================================================
// Fragment Shaders
// ============================================================================

/// Cascade update pass - updates one cascade level
@fragment
fn radiance_passthrough(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSample(gbuffer_albedo, linear_sampler, in.uv);
    return vec4<f32>(scene.rgb, 1.0);
}

@fragment
fn radiance_sun_visibility(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;
    let scene = textureSample(gbuffer_albedo, linear_sampler, uv);
    let depth = depth_at_uv(uv);
    if is_sky_depth(depth) {
        return vec4<f32>(scene.rgb, 1.0);
    }

    let world_pos = reconstruct_world_position(uv, depth);
    let normal = normalize(textureSample(gbuffer_normal, linear_sampler, uv).xyz * 2.0 - 1.0);
    let n_dot_l = max(dot(normal, params.sun_direction), 0.0);
    var direct_shadow = 1.0;
    if use_naadf_for_query(NAADF_QUERY_SUN_VISIBILITY) {
        let visibility = soft_shadow_backend(
            world_pos + normal * params.normal_bias,
            params.sun_direction,
            100.0,
            16.0,
        );
        direct_shadow *= mix(1.0, visibility, n_dot_l * 0.35);
    }
    if use_naadf_for_query(NAADF_QUERY_CONTACT_SHADOW) {
        let contact_shadow = contact_shadow_backend(world_pos, normal, params.sun_direction);
        direct_shadow *= mix(1.0, contact_shadow, n_dot_l * 0.5);
    }

    var ao_factor = 1.0;
    if use_naadf_for_query(NAADF_QUERY_TERRAIN_AO) {
        let ao = terrain_ao_backend(world_pos, normal);
        ao_factor = mix(1.0, ao, params.ambient_occlusion_strength);
    }
    let secondary_gi = radiance_secondary_gi(world_pos, normal, scene.rgb, uv);

    return vec4(scene.rgb * direct_shadow * ao_factor + secondary_gi, 1.0);
}

@fragment
fn update_cascade(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;
    let screen_size = vec2<f32>(textureDimensions(gbuffer_depth));
    
    // Get blue noise for temporal jitter
    let noise_uv = fract(uv * screen_size / 64.0 + vec2<f32>(f32(params.frame_index) * 0.618));
    let noise = textureSample(blue_noise, linear_sampler, noise_uv).r;
    
    // Sample G-buffer
    let depth = depth_at_uv(uv);
    if is_sky_depth(depth) {
        // Sky pixel
        return vec4<f32>(0.0);
    }
    
    let world_pos = reconstruct_world_position(uv, depth);
    let normal = normalize(textureSample(gbuffer_normal, linear_sampler, uv).xyz * 2.0 - 1.0);
    
    // Determine cascade level from uniform or shader variant
    // For simplicity, using cascade 0 here
    let cascade_level = 0u;
    
    let radiance = compute_probe_radiance(world_pos, normal, cascade_level, noise);
    
    return vec4<f32>(radiance, 1.0);
}

/// Final composite pass - applies GI to scene
@fragment
fn composite_gi(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;
    
    // Sample G-buffer
    let depth = depth_at_uv(uv);
    if is_sky_depth(depth) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    
    let world_pos = reconstruct_world_position(uv, depth);
    let normal = normalize(textureSample(gbuffer_normal, linear_sampler, uv).xyz * 2.0 - 1.0);
    let albedo = textureSample(gbuffer_albedo, linear_sampler, uv).rgb;
    
    // Merge all cascade levels
    let indirect = merge_cascades(uv, world_pos, normal);
    
    // Apply GI with albedo modulation
    var gi_contribution = indirect * albedo * params.gi_intensity;
    
    // Add ambient occlusion from SDF
    let ao = terrain_ao_backend(world_pos, normal);
    gi_contribution *= mix(1.0, ao, params.ambient_occlusion_strength);
    
    // Temporal blend with history
    let history = textureSample(history_texture, linear_sampler, uv).rgb;
    let blended = mix(gi_contribution, history, params.temporal_blend);
    
    return vec4<f32>(blended, 1.0);
}

// ============================================================================
// Compute Shader for Cascade Update
// ============================================================================

@compute @workgroup_size(8, 8, 1)
fn update_cascade_compute(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(workgroup_id) workgroup_id: vec3<u32>,
) {
    // Compute shader variant for better occupancy
    // Implementation similar to fragment shader
    let screen_size = vec2<f32>(textureDimensions(gbuffer_depth));
    let uv = (vec2<f32>(global_id.xy) + 0.5) / screen_size;
    
    // ... rest of implementation
}
