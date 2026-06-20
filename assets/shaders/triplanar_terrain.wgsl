// Triplanar terrain shader - Keep Lean for RTX 40xx
// Per-category optimization: terrain uses albedo + normal only
// Roughness is uniform per material (saves 3 texture samples per fragment)
// SSAO handles ambient occlusion screen-space
// Target: ~64 chunks, 1.5ms frame budget, 6 samples/fragment

#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::{pbr_fragment, pbr_functions, pbr_types}
#import bevy_pbr::mesh_view_bindings::globals
#import bevy_pbr::mesh_view_bindings::view
#import water_caustics
#import weather_common
#import "shaders/procedural/terrain_material_common.wgsl"::{
    sample_procedural_terrain_material,
}

#ifdef TERRAIN_HEX_TILING
#import "shaders/terrain/hextile.wgsl"::{
    hex_color_sample,
    hex_normal_derivative,
    hex_planar_coords,
}
#import "shaders/terrain/surfgrad.wgsl"::{
    resolve_normal_from_surface_gradient,
    surfgrad_from_triplanar_projection,
}
#endif

struct TriplanarUniforms {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    parallax_scale: f32, // Only used for rock material
    ao_strength: f32,    // 0.0 = V0.3 look (no baked AO), 1.0 = full AO
    rain_factor: f32,
    wetness: f32,
    in_rainy: f32,
    snow_factor: f32,
    in_snowy: f32,
    puddle_strength: f32,
    puddle_noise_scale: f32,
    puddle_normal_strength: f32,
    snow_tint_strength: f32,
    weather_time: f32,
    weather_flags: u32,
    clod_fade: f32,
    procedural_support_maps_enabled: f32,
    procedural_snow_mask: vec4<f32>,
    procedural_wet_mask: vec4<f32>,
    procedural_slope_masks: vec4<f32>,
    procedural_tint_strengths: vec4<f32>,
    procedural_material_roughness: vec4<f32>,
    procedural_moss_tint: vec4<f32>,
    procedural_gravel_tint: vec4<f32>,
    procedural_wet_tint: vec4<f32>,
    procedural_snow_tint: vec4<f32>,
    procedural_material_params: vec4<f32>,
};

// Uniform roughness values per terrain material (no texture maps needed)
const GRASS_ROUGHNESS: f32 = 0.85;
const ROCK_ROUGHNESS: f32 = 0.90;
const SAND_ROUGHNESS: f32 = 0.98;
const DIRT_ROUGHNESS: f32 = 0.92;

// Wet sand effect constants
const WATER_LEVEL: f32 = 18.0;
const WET_SAND_HEIGHT: f32 = 5.0;  // How far above water level gets wet
const WET_SAND_DARKEN: f32 = 0.85; // Subtle darkening only - closer to V0.3 look
const WET_SAND_MAX_STRENGTH: f32 = 0.55;
const WET_ROUGHNESS: f32 = 0.25;   // Wet surfaces are shinier

const DEBUG_FORCE_ALBEDO: bool = false;
const DEBUG_ALBEDO_COLOR: vec4<f32> = vec4<f32>(0.0, 1.0, 0.0, 1.0);
const WEATHER_DEBUG_PUDDLE: u32 = 1u << 8u;
const WEATHER_DEBUG_WETNESS: u32 = 1u << 9u;
const WEATHER_DEBUG_SNOW: u32 = 1u << 10u;
const TRIPLANAR_DEBUG_LOD_FLAG_SHIFT: u32 = 24u;

fn triplanar_debug_lod_level() -> u32 {
    return (uniforms.weather_flags >> TRIPLANAR_DEBUG_LOD_FLAG_SHIFT) & 0xffu;
}

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: TriplanarUniforms;

#ifdef TERRAIN_CLOD_DITHER
fn clod_interleaved_gradient_noise(p: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}
#endif

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
    return world_coord / uniforms.tex_scale;
}

fn triplanar_weights(world_normal: vec3<f32>) -> vec3<f32> {
    let normal_abs = abs(world_normal);
    var weights = vec3<f32>(
        pow(normal_abs.x, uniforms.blend_sharpness),
        pow(normal_abs.y, uniforms.blend_sharpness),
        pow(normal_abs.z, uniforms.blend_sharpness)
    );
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

fn sample_albedo_single(uv: vec2<f32>, mat: i32) -> vec4<f32> {
    if (mat == 0) {
        return textureSample(grass_albedo, tex_sampler, uv);
    } else if (mat == 1) {
        return textureSample(rock_albedo, tex_sampler, uv);
    } else if (mat == 2) {
        return textureSample(sand_albedo, tex_sampler, uv);
    }
    return textureSample(dirt_albedo, tex_sampler, uv);
}

// Sample albedo with optional parallax for rock
fn sample_albedo_tp(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, mat: i32, view_dir: vec3<f32>) -> vec4<f32> {
    var cy = uv_yz; var cz = uv_xz; var cx = uv_xy;
    
#ifndef TERRAIN_CHEAP_TRIPLANAR
    // Apply parallax only to rock material
    if (mat == 1) {
        cy = parallax_offset(uv_yz, view_dir);
        cz = parallax_offset(uv_xz, view_dir);
        cx = parallax_offset(uv_xy, view_dir);
    }
#endif
    
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

#ifdef TERRAIN_HEX_TILING
// Fraction of the cutoff distance over which hex tiling fades back to plain
// triplanar, so the switch isn't a hard ring around the camera.
const HEX_BLEND_BAND_FRAC: f32 = 0.15;

fn hex_albedo_weight(frag_dist: f32) -> f32 {
    if (hex_tiling.enabled == 0u) {
        return 0.0;
    }
    let band = max(hex_tiling.mid_distance * HEX_BLEND_BAND_FRAC, 1.0);
    return 1.0 - smoothstep(hex_tiling.mid_distance - band, hex_tiling.mid_distance, frag_dist);
}

fn hex_normal_weight(frag_dist: f32) -> f32 {
    if (hex_tiling.enabled == 0u || hex_tiling.normal_enabled == 0u) {
        return 0.0;
    }
    let band = max(hex_tiling.near_distance * HEX_BLEND_BAND_FRAC, 1.0);
    return 1.0 - smoothstep(hex_tiling.near_distance - band, hex_tiling.near_distance, frag_dist);
}

fn sample_hex_albedo_plane(world_coord: vec2<f32>, tex: texture_2d<f32>) -> vec4<f32> {
    let st = hex_planar_coords(world_coord, uniforms.tex_scale);
    return hex_color_sample(
        tex,
        tex_sampler,
        st,
        hex_tiling.rotation_strength,
        hex_tiling.color_border_contrast,
    );
}

fn sample_hex_albedo_plane_mat(world_coord: vec2<f32>, mat: i32) -> vec4<f32> {
    if (mat == 0) {
        return sample_hex_albedo_plane(world_coord, grass_albedo);
    } else if (mat == 1) {
        return sample_hex_albedo_plane(world_coord, rock_albedo);
    } else if (mat == 2) {
        return sample_hex_albedo_plane(world_coord, sand_albedo);
    }
    return sample_hex_albedo_plane(world_coord, dirt_albedo);
}

// Triplanar hex albedo path inspired by hextile-demo CommonTriplanarColor.
fn sample_albedo_tp_hextile(world_pos: vec3<f32>, w: vec3<f32>, mat: i32) -> vec4<f32> {
    let col_yz = sample_hex_albedo_plane_mat(world_pos.yz, mat) * w.x;
    let col_xz = sample_hex_albedo_plane_mat(world_pos.xz, mat) * w.y;
    let col_xy = sample_hex_albedo_plane_mat(world_pos.xy, mat) * w.z;
    return col_yz + col_xz + col_xy;
}

fn sample_hex_normal_plane(world_coord: vec2<f32>, tex: texture_2d<f32>) -> vec2<f32> {
    let st = hex_planar_coords(world_coord, uniforms.tex_scale);
    return hex_normal_derivative(
        tex,
        tex_sampler,
        st,
        hex_tiling.rotation_strength,
        hex_tiling.normal_border_contrast,
    );
}

fn sample_hex_normal_plane_mat(world_coord: vec2<f32>, mat: i32) -> vec2<f32> {
    if (mat == 0) {
        return sample_hex_normal_plane(world_coord, grass_normal);
    } else if (mat == 1) {
        return sample_hex_normal_plane(world_coord, rock_normal);
    } else if (mat == 2) {
        return sample_hex_normal_plane(world_coord, sand_normal);
    }
    return sample_hex_normal_plane(world_coord, dirt_normal);
}

// CommonTriplanarNormal-style path via surface gradients.
fn sample_normal_tp_hextile(
    world_pos: vec3<f32>,
    tp_weights: vec3<f32>,
    base_normal: vec3<f32>,
    mat: i32,
) -> vec3<f32> {
    let deriv_yz = sample_hex_normal_plane_mat(world_pos.yz, mat);
    let deriv_xz = sample_hex_normal_plane_mat(world_pos.xz, mat);
    let deriv_xy = sample_hex_normal_plane_mat(world_pos.xy, mat);
    let surf_grad = surfgrad_from_triplanar_projection(
        tp_weights,
        deriv_yz,
        deriv_xz,
        deriv_xy,
        base_normal,
    );
    return resolve_normal_from_surface_gradient(base_normal, surf_grad, uniforms.normal_intensity);
}
#endif

fn sample_normal_tp(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, wn: vec3<f32>, mat: i32, view_dir: vec3<f32>) -> vec3<f32> {
    var cy = uv_yz; var cz = uv_xz; var cx = uv_xy;
    
#ifndef TERRAIN_CHEAP_TRIPLANAR
    if (mat == 1) {
        cy = parallax_offset(uv_yz, view_dir);
        cz = parallax_offset(uv_xz, view_dir);
        cx = parallax_offset(uv_xy, view_dir);
    }
#endif
    
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

#ifdef TERRAIN_HEX_TILING
// Cross-fade between plain triplanar and hex tiling over the distance band.
// Only the band (0 < w < 1) pays for both samples; near/far paths sample one.
fn blend_albedo_tp(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, world_pos: vec3<f32>, w: vec3<f32>, mat: i32, view_dir: vec3<f32>, hex_w: f32) -> vec4<f32> {
    if (hex_w >= 1.0) {
        return sample_albedo_tp_hextile(world_pos, w, mat);
    }
    let plain = sample_albedo_tp(uv_yz, uv_xz, uv_xy, w, mat, view_dir);
    if (hex_w <= 0.0) {
        return plain;
    }
    return mix(plain, sample_albedo_tp_hextile(world_pos, w, mat), hex_w);
}

fn blend_normal_tp(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, world_pos: vec3<f32>, w: vec3<f32>, wn: vec3<f32>, mat: i32, view_dir: vec3<f32>, hex_w: f32) -> vec3<f32> {
    if (hex_w >= 1.0) {
        return sample_normal_tp_hextile(world_pos, w, wn, mat);
    }
    let plain = sample_normal_tp(uv_yz, uv_xz, uv_xy, w, wn, mat, view_dir);
    if (hex_w <= 0.0) {
        return plain;
    }
    return mix(plain, sample_normal_tp_hextile(world_pos, w, wn, mat), hex_w);
}
#endif

fn get_base_material(atlas_idx: i32) -> i32 {
    if (atlas_idx == 0) { return 0; }
    if (atlas_idx == 2 || atlas_idx == 3) { return 1; }
    if (atlas_idx == 4) { return 2; }
    return 3;
}

fn terrain_rain_wetness_mask(normal: vec3<f32>) -> f32 {
    let rain = max(uniforms.rain_factor, uniforms.in_rainy);
    let upness = weather_common::weather_upness_mask(normal, 0.22);
    return weather_common::safe_saturate(rain * uniforms.wetness * upness);
}

fn terrain_puddle_mask(world_xz: vec2<f32>, normal: vec3<f32>, roughness: f32) -> f32 {
    let rain = max(uniforms.rain_factor, uniforms.in_rainy);
    let base = rain * uniforms.wetness * uniforms.puddle_strength;
    let upness = weather_common::weather_upness_mask(normal, 0.38);
    let roughness_affinity = mix(0.55, 1.0, 1.0 - smoothstep(0.35, 0.95, roughness));
    let scale = max(uniforms.puddle_noise_scale, 0.001);
    let drift = vec2<f32>(uniforms.weather_time * 0.018, -uniforms.weather_time * 0.011);
    let noise = weather_common::weather_fbm_two_octave(world_xz * scale + drift);
    let breakup = mix(0.65, 1.0, smoothstep(0.42, 0.82, noise));
    return weather_common::safe_saturate(base * upness * upness * roughness_affinity * breakup);
}

fn terrain_puddle_normal(base_normal: vec3<f32>, world_xz: vec2<f32>, puddle_mask: f32) -> vec3<f32> {
    if (uniforms.puddle_normal_strength <= 0.001 || puddle_mask <= 0.001) {
        return base_normal;
    }

    let pos = world_xz * max(uniforms.puddle_noise_scale * 2.0, 0.001);
    let t = uniforms.weather_time;
    let n0 = weather_common::weather_value_noise(pos + vec2<f32>(t * 0.055, t * 0.021));
    let n1 = weather_common::weather_value_noise(pos + vec2<f32>(17.3 - t * 0.037, 5.7 + t * 0.049));
    let ripple = vec3<f32>(n0 - 0.5, 0.0, n1 - 0.5);
    return normalize(base_normal + ripple * uniforms.puddle_normal_strength * puddle_mask);
}

fn terrain_snow_mask(normal: vec3<f32>) -> f32 {
    let snow = max(uniforms.snow_factor, uniforms.in_snowy);
    let upness = weather_common::weather_upness_mask(normal, 0.30);
    return weather_common::safe_saturate(snow * uniforms.snow_tint_strength * upness);
}

const TERRAIN_BARYCENTRIC_SECTION_SCALE: f32 = 4.0;
const TERRAIN_BARYCENTRIC_LOD_U_SCALE: f32 = 2.0;

fn terrain_debug_section_color(section: u32) -> vec3<f32> {
    switch section {
        case 0u: { return vec3<f32>(1.0, 1.0, 1.0); }
        case 1u: { return vec3<f32>(0.0, 1.0, 1.0); }
        case 2u: { return vec3<f32>(1.0, 0.0, 1.0); }
        case 3u: { return vec3<f32>(1.0, 1.0, 0.0); }
        default: { return vec3<f32>(1.0, 1.0, 1.0); }
    }
}

fn terrain_debug_lod_wire_color(lod: u32) -> vec3<f32> {
    switch lod {
        case 0u: { return vec3<f32>(1.00, 1.00, 1.00); }
        case 1u: { return vec3<f32>(0.05, 0.20, 0.85); }
        case 2u: { return vec3<f32>(0.20, 0.95, 0.30); }
        case 3u: { return vec3<f32>(1.00, 0.50, 0.08); }
        default: { return vec3<f32>(1.00, 1.00, 1.00); }
    }
}

fn terrain_debug_wire_color(section: u32, lod: u32) -> vec3<f32> {
    let lod_color = terrain_debug_lod_wire_color(lod);
    if (section == 0u) {
        return lod_color;
    }
    let section_color = terrain_debug_section_color(section);
    return mix(lod_color, section_color, 0.72);
}

fn apply_terrain_debug_wireframe(base_color: vec4<f32>, uv_b: vec2<f32>) -> vec4<f32> {
    let lod = min(u32(floor(uv_b.x / TERRAIN_BARYCENTRIC_LOD_U_SCALE)), 3u);
    let bary_u = uv_b.x - f32(lod) * TERRAIN_BARYCENTRIC_LOD_U_SCALE;
    let section = u32(floor(uv_b.y / TERRAIN_BARYCENTRIC_SECTION_SCALE));
    let bary_v = uv_b.y - f32(section) * TERRAIN_BARYCENTRIC_SECTION_SCALE;
    let bary = vec3<f32>(bary_u, bary_v, 1.0 - bary_u - bary_v);
    let edge = min(bary.x, min(bary.y, bary.z));
    let line = 1.0 - smoothstep(0.01, 0.03, edge);
    let wire_color = terrain_debug_wire_color(section, lod);
    return vec4<f32>(mix(base_color.rgb, wire_color, line * 0.85), base_color.a);
}

struct TerrainIsoBandUniforms {
    world_min: vec3<f32>,
    _pad0: f32,
    inv_extent: vec3<f32>,
    epsilon: f32,
    mismatch_threshold: f32,
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
}

@group(#{MATERIAL_BIND_GROUP}) @binding(10) var iso_band_volume: texture_3d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(11) var iso_band_sampler: sampler;
@group(#{MATERIAL_BIND_GROUP}) @binding(12) var<uniform> iso_band: TerrainIsoBandUniforms;

struct HexTilingUniform {
    enabled: u32,
    normal_enabled: u32,
    rotation_strength: f32,
    color_border_contrast: f32,
    normal_border_contrast: f32,
    near_distance: f32,
    mid_distance: f32,
}

@group(#{MATERIAL_BIND_GROUP}) @binding(13) var<uniform> hex_tiling: HexTilingUniform;

fn sample_mesher_sdf(world_pos: vec3<f32>) -> f32 {
    let uvw = (world_pos - iso_band.world_min) * iso_band.inv_extent;
    if (any(uvw < vec3<f32>(0.0)) || any(uvw > vec3<f32>(1.0))) {
        return 1.0;
    }
    return textureSampleLevel(iso_band_volume, iso_band_sampler, uvw, 0.0).r;
}

fn apply_terrain_iso_band_overlay(
    base_color: vec4<f32>,
    world_pos: vec3<f32>,
    world_normal: vec3<f32>,
) -> vec4<f32> {
    if (iso_band.epsilon <= 0.0) {
        return base_color;
    }

    let sdf_here = sample_mesher_sdf(world_pos);
    let band = 1.0 - smoothstep(iso_band.epsilon, iso_band.epsilon * 2.5, abs(sdf_here));
    var out = base_color;
    if (band > 0.001) {
        let band_color = vec3<f32>(1.0, 0.15, 0.85);
        out = vec4<f32>(mix(out.rgb, band_color, band * 0.85), out.a);
    }

    if (abs(sdf_here) > iso_band.mismatch_threshold) {
        let mismatch = smoothstep(
            iso_band.mismatch_threshold,
            iso_band.mismatch_threshold * 2.0,
            abs(sdf_here),
        );
        out = vec4<f32>(mix(out.rgb, vec3<f32>(1.0, 0.85, 0.0), mismatch * 0.75), out.a);
    }

    // Where the iso surface along the normal diverges from the mesh point, tint blue.
    let sdf_along_normal = sample_mesher_sdf(world_pos + world_normal * iso_band.epsilon * 2.0);
    if (sdf_here * sdf_along_normal < 0.0) {
        let crossing = 1.0 - smoothstep(iso_band.epsilon, iso_band.epsilon * 3.0, abs(sdf_here));
        out = vec4<f32>(mix(out.rgb, vec3<f32>(0.2, 0.75, 1.0), crossing * 0.45), out.a);
    }

    return out;
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> @location(0) vec4<f32> {
#ifdef TERRAIN_CLOD_DITHER
    if (clod_interleaved_gradient_noise(in.position.xy) > clamp(uniforms.clod_fade, 0.0, 1.0)) {
        discard;
    }
#endif

    var pbr_input = pbr_fragment::pbr_input_from_vertex_output(in, is_front, true);
    let world_pos = pbr_input.world_position.xyz;
    let raw_world_normal = normalize(in.world_normal);
    let world_normal = normalize(pbr_input.world_normal);
    let view_dir = pbr_input.V;
    let frag_dist = length(view.world_position - world_pos);

#ifdef TERRAIN_DEBUG_NORMALS
    var debug_color = vec4<f32>(raw_world_normal * 0.5 + 0.5, 1.0);
#ifdef TERRAIN_DEBUG_WIREFRAME
    debug_color = apply_terrain_debug_wireframe(debug_color, in.uv_b);
#endif
    debug_color = apply_terrain_iso_band_overlay(debug_color, world_pos, raw_world_normal);
    return vec4<f32>(debug_color.rgb, 1.0);
#endif

#ifdef TERRAIN_DEBUG_FLAT_UNLIT
    var flat_color = vec4<f32>(0.72, 0.82, 0.88, 1.0);
#ifdef TERRAIN_DEBUG_WIREFRAME
    flat_color = apply_terrain_debug_wireframe(flat_color, in.uv_b);
#endif
    flat_color = apply_terrain_iso_band_overlay(flat_color, world_pos, world_normal);
    return vec4<f32>(flat_color.rgb, 1.0);
#endif
    
    // Use vertex colors as material weights
    let mat_weights = in.color; 
    
    // Normalize weights to ensure unity
    let w_total = dot(mat_weights, vec4<f32>(1.0));
    let w = mat_weights / max(w_total, 0.001);

    let w_max = max(max(w.x, w.y), max(w.z, w.w));
    var mat_idx = 0;
    if (w.y == w_max) { mat_idx = 1; }
    else if (w.z == w_max) { mat_idx = 2; }
    else if (w.w == w_max) { mat_idx = 3; }

#ifdef TERRAIN_HORIZON_PROXY
    let proxy_uv = compute_uv(world_pos.xz);
    var proxy_albedo = vec4<f32>(0.0);
    if (w_max > 0.95) {
        proxy_albedo = sample_albedo_single(proxy_uv, mat_idx);
    } else {
        if (w.x > 0.001) { proxy_albedo += sample_albedo_single(proxy_uv, 0) * w.x; }
        if (w.y > 0.001) { proxy_albedo += sample_albedo_single(proxy_uv, 1) * w.y; }
        if (w.z > 0.001) { proxy_albedo += sample_albedo_single(proxy_uv, 2) * w.z; }
        if (w.w > 0.001) { proxy_albedo += sample_albedo_single(proxy_uv, 3) * w.w; }
    }
    proxy_albedo = proxy_albedo * uniforms.base_color;
    let fog_color = vec3<f32>(0.56, 0.68, 0.82);
    let fog_mix = clamp((frag_dist - 220.0) / 220.0, 0.35, 0.82);
    let height_tint = clamp((world_pos.y - WATER_LEVEL) / 128.0, 0.0, 1.0);
    let textured_silhouette = proxy_albedo.rgb * mix(0.72, 0.9, height_tint);
    let horizon_color = mix(textured_silhouette, fog_color, fog_mix);
    return vec4<f32>(horizon_color, 1.0);
#endif

#ifdef TERRAIN_ATLAS_ONLY_DEBUG
    pbr_input.material.base_color = vec4<f32>(
        w.x + 0.20 * w.w,
        w.z + 0.35 * w.x,
        w.y + 0.15 * w.z,
        1.0
    ) * uniforms.base_color;
    pbr_input.material.perceptual_roughness = 0.9;
    pbr_input.material.metallic = 0.0;
    pbr_input.N = world_normal;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_DOUBLE_SIDED_BIT;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_FOG_ENABLED_BIT;
    var debug_color = pbr_functions::apply_pbr_lighting(pbr_input);
    debug_color = pbr_functions::main_pass_post_lighting_processing(pbr_input, debug_color);
    return vec4<f32>(debug_color.rgb, 1.0);
#endif

    let weights = triplanar_weights(world_normal);
    let uv_yz = compute_uv(world_pos.yz);
    let uv_xz = compute_uv(world_pos.xz);
    let uv_xy = compute_uv(world_pos.xy);
#ifdef TERRAIN_HEX_TILING
    let hex_albedo_w = hex_albedo_weight(frag_dist);
    let hex_normal_w = hex_normal_weight(frag_dist);
#endif

    var albedo = vec4<f32>(0.0);
    var final_normal = vec3<f32>(0.0);

    // ── Fast path: single-material dominance ────────────────────────
    // Most terrain fragments are purely one material.  When the dominant
    // weight > 0.95 we skip the other 3 material branches entirely,
    // cutting texture reads from 24 → 6 (or 3 when distant).
    // Distance check: skip expensive normal maps on distant terrain
#ifdef TERRAIN_CHEAP_TRIPLANAR
    let skip_normals = true;
#else
    let skip_normals = frag_dist > 120.0; // normal maps invisible past 120 u
#endif

#ifdef TERRAIN_SINGLE_PROJECTION_FAR
    let far_uv = compute_uv(world_pos.xz);
    if (w_max > 0.95) {
        albedo = sample_albedo_single(far_uv, mat_idx);
    } else {
        if (w.x > 0.001) { albedo += sample_albedo_single(far_uv, 0) * w.x; }
        if (w.y > 0.001) { albedo += sample_albedo_single(far_uv, 1) * w.y; }
        if (w.z > 0.001) { albedo += sample_albedo_single(far_uv, 2) * w.z; }
        if (w.w > 0.001) { albedo += sample_albedo_single(far_uv, 3) * w.w; }
    }
    final_normal = world_normal;
#else
    if (w_max > 0.95) {
        // Determine which single material dominates
#ifdef TERRAIN_HEX_TILING
        albedo = blend_albedo_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, mat_idx, view_dir, hex_albedo_w);
#else
        albedo = sample_albedo_tp(uv_yz, uv_xz, uv_xy, weights, mat_idx, view_dir);
#endif
        if (skip_normals) {
            final_normal = world_normal;
        } else {
#ifdef TERRAIN_HEX_TILING
            final_normal = blend_normal_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, world_normal, mat_idx, view_dir, hex_normal_w);
#else
            final_normal = sample_normal_tp(uv_yz, uv_xz, uv_xy, weights, world_normal, mat_idx, view_dir);
#endif
        }
    } else {
        // ── Blend path: sample only materials with significant weight ──
        // Material 0: Grass
        if (w.x > 0.001) {
#ifdef TERRAIN_HEX_TILING
            albedo += blend_albedo_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, 0, view_dir, hex_albedo_w) * w.x;
#else
            albedo += sample_albedo_tp(uv_yz, uv_xz, uv_xy, weights, 0, view_dir) * w.x;
#endif
            if (!skip_normals) {
#ifdef TERRAIN_HEX_TILING
                final_normal += blend_normal_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, world_normal, 0, view_dir, hex_normal_w) * w.x;
#else
                final_normal += sample_normal_tp(uv_yz, uv_xz, uv_xy, weights, world_normal, 0, view_dir) * w.x;
#endif
            }
        }

        // Material 1: Rock
        if (w.y > 0.001) {
#ifdef TERRAIN_HEX_TILING
            albedo += blend_albedo_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, 1, view_dir, hex_albedo_w) * w.y;
#else
            albedo += sample_albedo_tp(uv_yz, uv_xz, uv_xy, weights, 1, view_dir) * w.y;
#endif
            if (!skip_normals) {
#ifdef TERRAIN_HEX_TILING
                final_normal += blend_normal_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, world_normal, 1, view_dir, hex_normal_w) * w.y;
#else
                final_normal += sample_normal_tp(uv_yz, uv_xz, uv_xy, weights, world_normal, 1, view_dir) * w.y;
#endif
            }
        }

        // Material 2: Sand
        if (w.z > 0.001) {
#ifdef TERRAIN_HEX_TILING
            albedo += blend_albedo_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, 2, view_dir, hex_albedo_w) * w.z;
#else
            albedo += sample_albedo_tp(uv_yz, uv_xz, uv_xy, weights, 2, view_dir) * w.z;
#endif
            if (!skip_normals) {
#ifdef TERRAIN_HEX_TILING
                final_normal += blend_normal_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, world_normal, 2, view_dir, hex_normal_w) * w.z;
#else
                final_normal += sample_normal_tp(uv_yz, uv_xz, uv_xy, weights, world_normal, 2, view_dir) * w.z;
#endif
            }
        }

        // Material 3: Dirt
        if (w.w > 0.001) {
#ifdef TERRAIN_HEX_TILING
            albedo += blend_albedo_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, 3, view_dir, hex_albedo_w) * w.w;
#else
            albedo += sample_albedo_tp(uv_yz, uv_xz, uv_xy, weights, 3, view_dir) * w.w;
#endif
            if (!skip_normals) {
#ifdef TERRAIN_HEX_TILING
                final_normal += blend_normal_tp(uv_yz, uv_xz, uv_xy, world_pos, weights, world_normal, 3, view_dir, hex_normal_w) * w.w;
#else
                final_normal += sample_normal_tp(uv_yz, uv_xz, uv_xy, weights, world_normal, 3, view_dir) * w.w;
#endif
            }
        }

        if (skip_normals) {
            final_normal = world_normal;
        }
    }
#endif
    
    albedo = albedo * uniforms.base_color;
    var blended_n = normalize(final_normal);

    // Baked vertex AO - controlled by ao_strength uniform
    // 0.0 = V0.3 look (soft shadows via SSAO only)
    // 1.0 = full baked AO (darker shadows in crevices)
    let vertex_ao = clamp(in.uv.x, 0.0, 1.0);
    let ao_factor = mix(1.0, vertex_ao, uniforms.ao_strength);

    // Calculate uniform roughness based on material blend
    var roughness = w.x * GRASS_ROUGHNESS +
                    w.y * ROCK_ROUGHNESS +
                    w.z * SAND_ROUGHNESS +
                    w.w * DIRT_ROUGHNESS;

    // Wet sand effect: darken and smooth shoreline sand/dirt near water level.
    let height_above_water = world_pos.y - WATER_LEVEL;
    let wet_factor = clamp(1.0 - (height_above_water / WET_SAND_HEIGHT), 0.0, 1.0);
    let wet_material_mask = clamp(w.z + w.w * 0.35, 0.0, 1.0);
    let wet_surface_mask = smoothstep(0.18, 0.62, world_normal.y);
    let wet_strength = wet_factor * wet_factor * wet_material_mask * wet_surface_mask * WET_SAND_MAX_STRENGTH;

    // Darken the albedo for wet terrain
    let wet_albedo = albedo * vec4<f32>(WET_SAND_DARKEN, WET_SAND_DARKEN, WET_SAND_DARKEN, 1.0);
    var final_albedo = mix(albedo, wet_albedo, wet_strength);

    // Reduce roughness for wet surfaces (wet = shinier)
    roughness = mix(roughness, WET_ROUGHNESS, wet_strength);

    var rain_wet_strength = 0.0;
    var puddle_mask = 0.0;
    var snow_mask = 0.0;
    if (uniforms.rain_factor > 0.001 || uniforms.wetness > 0.001 || uniforms.snow_factor > 0.001) {
        rain_wet_strength = terrain_rain_wetness_mask(world_normal);
        let rain_wet_albedo = final_albedo * vec4<f32>(0.88, 0.91, 0.94, 1.0);
        final_albedo = mix(final_albedo, rain_wet_albedo, rain_wet_strength * 0.55);
        roughness = mix(roughness, max(0.24, roughness * 0.72), rain_wet_strength);

        if (rain_wet_strength > 0.001 && uniforms.puddle_strength > 0.001) {
            puddle_mask = terrain_puddle_mask(world_pos.xz, world_normal, roughness);
            final_albedo = mix(final_albedo, final_albedo * vec4<f32>(0.82, 0.88, 0.93, 1.0), puddle_mask);
            roughness = mix(roughness, 0.12, puddle_mask);

            if (!skip_normals) {
                blended_n = terrain_puddle_normal(blended_n, world_pos.xz, puddle_mask);
            }
        }

        snow_mask = terrain_snow_mask(world_normal);
        let snow_albedo = vec4<f32>(max(final_albedo.rgb, vec3<f32>(0.88, 0.90, 0.94)), final_albedo.a);
        final_albedo = mix(final_albedo, snow_albedo, snow_mask);
        roughness = mix(roughness, 0.78, snow_mask);
    }

    var final_ao = ao_factor;
    if (uniforms.procedural_support_maps_enabled > 0.5) {
        let procedural_material = sample_procedural_terrain_material(
            world_pos,
            world_normal,
            w,
            frag_dist,
            final_albedo.rgb,
            blended_n,
            roughness,
            ao_factor,
            uniforms.procedural_snow_mask,
            uniforms.procedural_wet_mask,
            uniforms.procedural_slope_masks,
            uniforms.procedural_tint_strengths,
            uniforms.procedural_material_roughness,
            uniforms.procedural_moss_tint,
            uniforms.procedural_gravel_tint,
            uniforms.procedural_wet_tint,
            uniforms.procedural_snow_tint,
            uniforms.procedural_material_params,
        );
        final_albedo = vec4<f32>(procedural_material.albedo, final_albedo.a);
        blended_n = procedural_material.normal_ws;
        roughness = procedural_material.roughness;
        final_ao = procedural_material.ao;
    }

    if ((uniforms.weather_flags & WEATHER_DEBUG_PUDDLE) != 0u) {
        final_albedo = vec4<f32>(vec3<f32>(puddle_mask), 1.0);
        roughness = 0.9;
    } else if ((uniforms.weather_flags & WEATHER_DEBUG_WETNESS) != 0u) {
        final_albedo = vec4<f32>(vec3<f32>(rain_wet_strength), 1.0);
        roughness = 0.9;
    } else if ((uniforms.weather_flags & WEATHER_DEBUG_SNOW) != 0u) {
        final_albedo = vec4<f32>(vec3<f32>(snow_mask), 1.0);
        roughness = 0.9;
    }

    pbr_input.material.base_color = final_albedo;
    pbr_input.material.perceptual_roughness = clamp(roughness, 0.04, 1.0);
    pbr_input.material.metallic = 0.0;
    pbr_input.N = blended_n;
    pbr_input.diffuse_occlusion = vec3<f32>(final_ao);
    pbr_input.specular_occlusion = final_ao;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_DOUBLE_SIDED_BIT;
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_FOG_ENABLED_BIT;
    // The lit path currently collapses sampled terrain albedo to the fog color on DX12.
    pbr_input.material.flags |= pbr_types::STANDARD_MATERIAL_FLAGS_UNLIT_BIT;

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

    // Underwater caustics: add animated light patterns to terrain below water level
    if (world_pos.y < WATER_LEVEL) {
        let caustic_surface_mask = smoothstep(0.25, 0.65, world_normal.y);
        let shoreline_caustic_falloff = 1.0 - smoothstep(WATER_LEVEL - 0.5, WATER_LEVEL, world_pos.y);
        let caustic = water_caustics::calculate_caustics(
            world_pos, WATER_LEVEL, globals.time,
            0.85,   // caustic_intensity (from water.yaml default)
            1.2     // caustic_scale (from water.yaml default)
        ) * shoreline_caustic_falloff * caustic_surface_mask;
        color = vec4<f32>(color.rgb + water_caustics::caustic_color(caustic), color.a);
    }

    color = pbr_functions::main_pass_post_lighting_processing(pbr_input, color);

#ifdef TERRAIN_DEBUG_WIREFRAME
    color = apply_terrain_debug_wireframe(color, in.uv_b);
#endif

    color = apply_terrain_iso_band_overlay(color, world_pos, world_normal);

    return vec4<f32>(color.rgb, 1.0);
}
