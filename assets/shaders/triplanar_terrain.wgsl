// Triplanar terrain shader - Keep Lean for RTX 40xx
// Per-category optimization: terrain uses albedo + normal only
// Roughness is uniform per material (saves 3 texture samples per fragment)
// SSAO handles ambient occlusion screen-space
// Target: ~64 chunks, 1.5ms frame budget, 6 samples/fragment

#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::{pbr_fragment, pbr_functions, pbr_types}

struct TriplanarUniforms {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    parallax_scale: f32, // Only used for rock material
};

// Uniform roughness values per terrain material (no texture maps needed)
const GRASS_ROUGHNESS: f32 = 0.85;
const ROCK_ROUGHNESS: f32 = 0.90;
const SAND_ROUGHNESS: f32 = 0.98;
const DIRT_ROUGHNESS: f32 = 0.92;

// Wet sand effect constants
const WATER_LEVEL: f32 = 18.0;
const WET_SAND_HEIGHT: f32 = 5.0;  // How far above water level gets wet
const WET_SAND_DARKEN: f32 = 0.45; // Darken factor (lower = darker)
const WET_ROUGHNESS: f32 = 0.25;   // Wet surfaces are shinier

const DEBUG_FORCE_ALBEDO: bool = false;
const DEBUG_ALBEDO_COLOR: vec4<f32> = vec4<f32>(0.0, 1.0, 0.0, 1.0);

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: TriplanarUniforms;

// Grass textures (material 0)
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var grass_albedo: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var tex_sampler: sampler;
@group(#{MATERIAL_BIND_GROUP}) @binding(3) var grass_normal: texture_2d<f32>;

// Rock textures (material 1)
@group(#{MATERIAL_BIND_GROUP}) @binding(4) var rock_albedo: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(5) var rock_normal: texture_2d<f32>;

// Sand textures (material 2)
@group(#{MATERIAL_BIND_GROUP}) @binding(6) var sand_albedo: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(7) var sand_normal: texture_2d<f32>;

// Dirt textures (material 3)
@group(#{MATERIAL_BIND_GROUP}) @binding(8) var dirt_albedo: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(9) var dirt_normal: texture_2d<f32>;

fn compute_uv(world_coord: vec2<f32>) -> vec2<f32> {
    return fract(world_coord / uniforms.tex_scale);
}

fn triplanar_weights(world_normal: vec3<f32>) -> vec3<f32> {
    var weights = pow(abs(world_normal), vec3(uniforms.blend_sharpness));
    return weights / max(weights.x + weights.y + weights.z, 0.001);
}

fn unpack_normal(sampled: vec3<f32>) -> vec3<f32> {
    return normalize(sampled * 2.0 - 1.0);
}

fn reorient_normal(tn: vec3<f32>, wn: vec3<f32>, axis: i32) -> vec3<f32> {
    var n = vec3(tn.xy * uniforms.normal_intensity, tn.z);
    n = normalize(n);
    if (axis == 0) { return normalize(vec3(n.z * sign(wn.x), n.y, n.x)); }
    if (axis == 1) { return normalize(vec3(n.x, n.z * sign(wn.y), n.y)); }
    return normalize(vec3(n.x, n.y, n.z * sign(wn.z)));
}

// Derive height from normal map - steeper normals = lower height
fn get_height_from_normal(normal_sample: vec3<f32>) -> f32 {
    let unpacked = unpack_normal(normal_sample);
    // Z component of normal: flat = 1.0 (high), steep = close to 0 (low)
    return unpacked.z * 0.5 + 0.5;
}

// Simple parallax offset using normal-derived height for rock
fn parallax_offset(uv: vec2<f32>, view_dir: vec3<f32>) -> vec2<f32> {
    let normal_sample = textureSample(rock_normal, tex_sampler, uv).rgb;
    let height = get_height_from_normal(normal_sample);
    let offset = view_dir.xy * (height * uniforms.parallax_scale);
    return uv - offset;
}

// Sample albedo with optional parallax for rock
fn sample_albedo_tp(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, mat: i32, view_dir: vec3<f32>) -> vec4<f32> {
    var cy = uv_yz; var cz = uv_xz; var cx = uv_xy;
    
    // Apply parallax only to rock material
    if (mat == 1) {
        cy = parallax_offset(uv_yz, view_dir);
        cz = parallax_offset(uv_xz, view_dir);
        cx = parallax_offset(uv_xy, view_dir);
    }
    
    var col: vec4<f32>;
    if (mat == 0) {
        col = textureSample(grass_albedo, tex_sampler, cy) * w.x +
              textureSample(grass_albedo, tex_sampler, cz) * w.y +
              textureSample(grass_albedo, tex_sampler, cx) * w.z;
    } else if (mat == 1) {
        col = textureSample(rock_albedo, tex_sampler, cy) * w.x +
              textureSample(rock_albedo, tex_sampler, cz) * w.y +
              textureSample(rock_albedo, tex_sampler, cx) * w.z;
    } else if (mat == 2) {
        col = textureSample(sand_albedo, tex_sampler, cy) * w.x +
              textureSample(sand_albedo, tex_sampler, cz) * w.y +
              textureSample(sand_albedo, tex_sampler, cx) * w.z;
    } else {
        col = textureSample(dirt_albedo, tex_sampler, cy) * w.x +
              textureSample(dirt_albedo, tex_sampler, cz) * w.y +
              textureSample(dirt_albedo, tex_sampler, cx) * w.z;
    }
    return col;
}

fn sample_normal_tp(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, wn: vec3<f32>, mat: i32, view_dir: vec3<f32>) -> vec3<f32> {
    var cy = uv_yz; var cz = uv_xz; var cx = uv_xy;
    
    if (mat == 1) {
        cy = parallax_offset(uv_yz, view_dir);
        cz = parallax_offset(uv_xz, view_dir);
        cx = parallax_offset(uv_xy, view_dir);
    }
    
    var nx: vec3<f32>; var ny: vec3<f32>; var nz: vec3<f32>;
    if (mat == 0) {
        nx = textureSample(grass_normal, tex_sampler, cy).rgb;
        ny = textureSample(grass_normal, tex_sampler, cz).rgb;
        nz = textureSample(grass_normal, tex_sampler, cx).rgb;
    } else if (mat == 1) {
        nx = textureSample(rock_normal, tex_sampler, cy).rgb;
        ny = textureSample(rock_normal, tex_sampler, cz).rgb;
        nz = textureSample(rock_normal, tex_sampler, cx).rgb;
    } else if (mat == 2) {
        nx = textureSample(sand_normal, tex_sampler, cy).rgb;
        ny = textureSample(sand_normal, tex_sampler, cz).rgb;
        nz = textureSample(sand_normal, tex_sampler, cx).rgb;
    } else {
        nx = textureSample(dirt_normal, tex_sampler, cy).rgb;
        ny = textureSample(dirt_normal, tex_sampler, cz).rgb;
        nz = textureSample(dirt_normal, tex_sampler, cx).rgb;
    }
    
    let n0 = reorient_normal(unpack_normal(nx), wn, 0);
    let n1 = reorient_normal(unpack_normal(ny), wn, 1);
    let n2 = reorient_normal(unpack_normal(nz), wn, 2);
    return normalize(n0 * w.x + n1 * w.y + n2 * w.z);
}

fn get_base_material(atlas_idx: i32) -> i32 {
    if (atlas_idx == 0) { return 0; }
    if (atlas_idx == 2 || atlas_idx == 3) { return 1; }
    if (atlas_idx == 4) { return 2; }
    return 3;
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> @location(0) vec4<f32> {
    var pbr_input = pbr_fragment::pbr_input_from_vertex_output(in, is_front, true);
    let world_pos = pbr_input.world_position.xyz;
    let world_normal = normalize(pbr_input.world_normal);
    let view_dir = pbr_input.V;
    
    // Use vertex colors as material weights
    let mat_weights = in.color; 
    
    // Normalize weights to ensure unity
    let w_total = dot(mat_weights, vec4<f32>(1.0));
    let w = mat_weights / max(w_total, 0.001);

    let weights = triplanar_weights(world_normal);
    let uv_yz = compute_uv(world_pos.yz);
    let uv_xz = compute_uv(world_pos.xz);
    let uv_xy = compute_uv(world_pos.xy);

    var albedo = vec4<f32>(0.0);
    var final_normal = vec3<f32>(0.0);

    // Optimization: Only sample materials with significant weight?
    // Note: Branching on non-uniform values with textureSample can cause artifacts.
    // Ideally we'd use textureSampleGrad, but for now we'll sample all active materials.
    // Modern GPUs handle this reasonable well.

    // Material 0: Grass
    if (w.x > 0.001) {
        albedo += sample_albedo_tp(uv_yz, uv_xz, uv_xy, weights, 0, view_dir) * w.x;
        final_normal += sample_normal_tp(uv_yz, uv_xz, uv_xy, weights, world_normal, 0, view_dir) * w.x;
    }

    // Material 1: Rock
    if (w.y > 0.001) {
        albedo += sample_albedo_tp(uv_yz, uv_xz, uv_xy, weights, 1, view_dir) * w.y;
        final_normal += sample_normal_tp(uv_yz, uv_xz, uv_xy, weights, world_normal, 1, view_dir) * w.y;
    }

    // Material 2: Sand
    if (w.z > 0.001) {
        albedo += sample_albedo_tp(uv_yz, uv_xz, uv_xy, weights, 2, view_dir) * w.z;
        final_normal += sample_normal_tp(uv_yz, uv_xz, uv_xy, weights, world_normal, 2, view_dir) * w.z;
    }

    // Material 3: Dirt
    if (w.w > 0.001) {
        albedo += sample_albedo_tp(uv_yz, uv_xz, uv_xy, weights, 3, view_dir) * w.w;
        final_normal += sample_normal_tp(uv_yz, uv_xz, uv_xy, weights, world_normal, 3, view_dir) * w.w;
    }
    
    albedo = albedo * uniforms.base_color;
    let blended_n = normalize(final_normal);

    // Baked vertex AO - SSAO handles the rest screen-space
    let baked_ao = clamp(in.uv.x, 0.0, 1.0);
    let ao_strength = 0.6;
    let ao_factor = 1.0 + (baked_ao - 1.0) * ao_strength;

    // Calculate uniform roughness based on material blend
    var roughness = w.x * GRASS_ROUGHNESS +
                    w.y * ROCK_ROUGHNESS +
                    w.z * SAND_ROUGHNESS +
                    w.w * DIRT_ROUGHNESS;

    // Wet sand effect: darken and smooth terrain near water level
    let height_above_water = world_pos.y - WATER_LEVEL;
    // Smooth gradient from water level up to WET_SAND_HEIGHT
    let wet_factor = clamp(1.0 - (height_above_water / WET_SAND_HEIGHT), 0.0, 1.0);
    // Apply to all terrain near water (sand, dirt, grass at shoreline)
    let wet_strength = wet_factor * wet_factor; // Quadratic falloff for natural look

    // Darken the albedo for wet terrain
    let wet_albedo = albedo * vec4<f32>(WET_SAND_DARKEN, WET_SAND_DARKEN, WET_SAND_DARKEN, 1.0);
    var final_albedo = mix(albedo, wet_albedo, wet_strength);

    // Reduce roughness for wet surfaces (wet = shinier)
    roughness = mix(roughness, WET_ROUGHNESS, wet_strength);

    pbr_input.material.base_color = final_albedo;
    pbr_input.material.perceptual_roughness = clamp(roughness, 0.04, 1.0);
    pbr_input.material.metallic = 0.0;
    pbr_input.N = blended_n;
    pbr_input.diffuse_occlusion = vec3<f32>(ao_factor);
    pbr_input.specular_occlusion = ao_factor;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_DOUBLE_SIDED_BIT;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_FOG_ENABLED_BIT;

    if (DEBUG_FORCE_ALBEDO) {
        pbr_input.material.base_color = DEBUG_ALBEDO_COLOR;
        pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_UNLIT_BIT;
    }

    var color: vec4<f32>;
    if ((pbr_input.material.flags & pbr_types::STANDARD_MATERIAL_FLAGS_UNLIT_BIT) == 0u) {
        color = pbr_functions::apply_pbr_lighting(pbr_input);
    } else {
        color = pbr_input.material.base_color;
    }

    color = pbr_functions::main_pass_post_lighting_processing(pbr_input, color);
    return color;
}
