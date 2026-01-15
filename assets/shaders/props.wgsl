// Props PBR shader - Medium detail for RTX 40xx
// Supports: albedo, normal, roughness (optional), vertex AO
// Texture samples per fragment: 9-12 (triplanar × maps)
// Target: ~2000 props, 1ms frame budget

#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::mesh_view_bindings::view

struct PropsUniforms {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    default_roughness: f32,
    fog_start: f32,
    fog_end: f32,
    _padding: vec2<f32>,
    fog_color: vec4<f32>,
};

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: PropsUniforms;

// Rock textures (material 0) - full props PBR
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var rock_albedo: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var tex_sampler: sampler;
@group(#{MATERIAL_BIND_GROUP}) @binding(3) var rock_normal: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(4) var rock_roughness: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(5) var rock_ao: texture_2d<f32>;

// Furniture textures (material 1) - standard PBR (vertex AO baked)
// @group(#{MATERIAL_BIND_GROUP}) @binding(6) var furniture_albedo: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(7) var furniture_normal: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(8) var furniture_roughness: texture_2d<f32>;

// Barrel/crate textures (material 2) - minimal (uniform roughness)
// @group(#{MATERIAL_BIND_GROUP}) @binding(9) var crate_albedo: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(10) var crate_normal: texture_2d<f32>;

// Uniform roughness values for materials without roughness maps
const CRATE_ROUGHNESS: f32 = 0.8;

struct PropsPbrSample {
    albedo: vec4<f32>,
    normal: vec3<f32>,
    roughness: f32,
    ao: f32,
};

// Baseline exposure used by Bevy when no explicit camera exposure is set (EV100_BLENDER = 9.7).
const EXPOSURE_BLENDER: f32 = 0.0010019079;

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

// Sample rock PBR (full detail with AO)
fn sample_rock_pbr(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, wn: vec3<f32>) -> PropsPbrSample {
    let albedo = textureSample(rock_albedo, tex_sampler, uv_yz) * w.x +
                 textureSample(rock_albedo, tex_sampler, uv_xz) * w.y +
                 textureSample(rock_albedo, tex_sampler, uv_xy) * w.z;

    let nx = textureSample(rock_normal, tex_sampler, uv_yz).rgb;
    let ny = textureSample(rock_normal, tex_sampler, uv_xz).rgb;
    let nz = textureSample(rock_normal, tex_sampler, uv_xy).rgb;
    let n0 = reorient_normal(unpack_normal(nx), wn, 0);
    let n1 = reorient_normal(unpack_normal(ny), wn, 1);
    let n2 = reorient_normal(unpack_normal(nz), wn, 2);
    let normal = normalize(n0 * w.x + n1 * w.y + n2 * w.z);

    let roughness = (textureSample(rock_roughness, tex_sampler, uv_yz).r * w.x +
                     textureSample(rock_roughness, tex_sampler, uv_xz).r * w.y +
                     textureSample(rock_roughness, tex_sampler, uv_xy).r * w.z);

    let ao = (textureSample(rock_ao, tex_sampler, uv_yz).r * w.x +
              textureSample(rock_ao, tex_sampler, uv_xz).r * w.y +
              textureSample(rock_ao, tex_sampler, uv_xy).r * w.z);

    return PropsPbrSample(albedo, normal, roughness, ao);
}

// Sample furniture PBR (vertex AO used instead of texture AO)
fn sample_furniture_pbr(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, wn: vec3<f32>, vertex_ao: f32) -> PropsPbrSample {
    let albedo = textureSample(furniture_albedo, tex_sampler, uv_yz) * w.x +
                 textureSample(furniture_albedo, tex_sampler, uv_xz) * w.y +
                 textureSample(furniture_albedo, tex_sampler, uv_xy) * w.z;

    let nx = textureSample(furniture_normal, tex_sampler, uv_yz).rgb;
    let ny = textureSample(furniture_normal, tex_sampler, uv_xz).rgb;
    let nz = textureSample(furniture_normal, tex_sampler, uv_xy).rgb;
    let n0 = reorient_normal(unpack_normal(nx), wn, 0);
    let n1 = reorient_normal(unpack_normal(ny), wn, 1);
    let n2 = reorient_normal(unpack_normal(nz), wn, 2);
    let normal = normalize(n0 * w.x + n1 * w.y + n2 * w.z);

    let roughness = (textureSample(furniture_roughness, tex_sampler, uv_yz).r * w.x +
                     textureSample(furniture_roughness, tex_sampler, uv_xz).r * w.y +
                     textureSample(furniture_roughness, tex_sampler, uv_xy).r * w.z);

    return PropsPbrSample(albedo, normal, roughness, vertex_ao);
}

// Sample crate/barrel PBR (minimal - uniform roughness)
fn sample_crate_pbr(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, wn: vec3<f32>, vertex_ao: f32) -> PropsPbrSample {
    let albedo = textureSample(crate_albedo, tex_sampler, uv_yz) * w.x +
                 textureSample(crate_albedo, tex_sampler, uv_xz) * w.y +
                 textureSample(crate_albedo, tex_sampler, uv_xy) * w.z;

    let nx = textureSample(crate_normal, tex_sampler, uv_yz).rgb;
    let ny = textureSample(crate_normal, tex_sampler, uv_xz).rgb;
    let nz = textureSample(crate_normal, tex_sampler, uv_xy).rgb;
    let n0 = reorient_normal(unpack_normal(nx), wn, 0);
    let n1 = reorient_normal(unpack_normal(ny), wn, 1);
    let n2 = reorient_normal(unpack_normal(nz), wn, 2);
    let normal = normalize(n0 * w.x + n1 * w.y + n2 * w.z);

    // Uniform roughness for barrels/crates
    return PropsPbrSample(albedo, normal, CRATE_ROUGHNESS, vertex_ao);
}

// Simplified Cook-Torrance BRDF
fn distribution_ggx(n_dot_h: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let n_dot_h2 = n_dot_h * n_dot_h;
    let denom = n_dot_h2 * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * denom * denom);
}

fn geometry_schlick_ggx(n_dot_v: f32, roughness: f32) -> f32 {
    let r = roughness + 1.0;
    let k = (r * r) / 8.0;
    return n_dot_v / (n_dot_v * (1.0 - k) + k);
}

fn geometry_smith(n_dot_v: f32, n_dot_l: f32, roughness: f32) -> f32 {
    return geometry_schlick_ggx(n_dot_v, roughness) * geometry_schlick_ggx(n_dot_l, roughness);
}

fn fresnel_schlick(cos_theta: f32, f0: vec3<f32>) -> vec3<f32> {
    return f0 + (1.0 - f0) * pow(1.0 - cos_theta, 5.0);
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let world_pos = in.world_position.xyz;
    let world_normal = normalize(in.world_normal);
    let view_dir = normalize(view.world_position - world_pos);

    // Material weights from vertex colors (r=rock, g=furniture, b=crate)
    let mat_weights = in.color;
    let w_total = mat_weights.r + mat_weights.g + mat_weights.b;
    let w = vec3(mat_weights.r, mat_weights.g, mat_weights.b) / max(w_total, 0.001);

    // Vertex AO from alpha channel or UV.x (baked in Blender)
    let vertex_ao = clamp(in.uv.x, 0.0, 1.0);

    let weights = triplanar_weights(world_normal);
    let uv_yz = compute_uv(world_pos.yz);
    let uv_xz = compute_uv(world_pos.xz);
    let uv_xy = compute_uv(world_pos.xy);

    var final_pbr = PropsPbrSample(vec4(0.0), vec3(0.0), 0.0, 0.0);

    // Sample each material weighted by vertex colors
    if (w.x > 0.001) {
        let pbr = sample_rock_pbr(uv_yz, uv_xz, uv_xy, weights, world_normal);
        final_pbr.albedo += pbr.albedo * w.x;
        final_pbr.normal += pbr.normal * w.x;
        final_pbr.roughness += pbr.roughness * w.x;
        final_pbr.ao += pbr.ao * w.x;
    }

    if (w.y > 0.001) {
        let pbr = sample_furniture_pbr(uv_yz, uv_xz, uv_xy, weights, world_normal, vertex_ao);
        final_pbr.albedo += pbr.albedo * w.y;
        final_pbr.normal += pbr.normal * w.y;
        final_pbr.roughness += pbr.roughness * w.y;
        final_pbr.ao += pbr.ao * w.y;
    }

    if (w.z > 0.001) {
        let pbr = sample_crate_pbr(uv_yz, uv_xz, uv_xy, weights, world_normal, vertex_ao);
        final_pbr.albedo += pbr.albedo * w.z;
        final_pbr.normal += pbr.normal * w.z;
        final_pbr.roughness += pbr.roughness * w.z;
        final_pbr.ao += pbr.ao * w.z;
    }

    let albedo = final_pbr.albedo.rgb * uniforms.base_color.rgb;
    let normal = normalize(final_pbr.normal);
    let roughness = clamp(final_pbr.roughness, 0.04, 1.0);
    let ao = final_pbr.ao;

    // PBR lighting (no metallic for props - they're wood/stone/organic)
    let light_dir = normalize(vec3(0.4, 0.8, 0.3));
    let half_dir = normalize(light_dir + view_dir);

    let n_dot_l = max(dot(normal, light_dir), 0.0);
    let n_dot_v = max(dot(normal, view_dir), 0.0);
    let n_dot_h = max(dot(normal, half_dir), 0.0);
    let h_dot_v = max(dot(half_dir, view_dir), 0.0);

    // Non-metallic F0 for dielectric materials
    let f0 = vec3(0.04);

    // Cook-Torrance BRDF
    let d = distribution_ggx(n_dot_h, roughness);
    let g = geometry_smith(n_dot_v, n_dot_l, roughness);
    let f = fresnel_schlick(h_dot_v, f0);

    let specular = (d * g * f) / max(4.0 * n_dot_v * n_dot_l, 0.001);

    // Energy conservation (fully dielectric)
    let k_s = f;
    let k_d = 1.0 - k_s;

    // Combine diffuse and specular
    let light_color = vec3(1.0, 0.95, 0.9); // Warm sunlight
    let ambient = vec3(0.15, 0.17, 0.2) * ao; // Cool ambient with AO

    let lo = (k_d * albedo / 3.14159265 + specular) * light_color * n_dot_l;
    var color = ambient * albedo + lo;

    // Aerial perspective - blend toward fog color based on distance
    let distance = length(view.world_position - world_pos);
    let fog_range = max(uniforms.fog_end - uniforms.fog_start, 1.0);
    let fog_factor = clamp((distance - uniforms.fog_start) / fog_range, 0.0, 1.0);
    color = mix(color, uniforms.fog_color.rgb, fog_factor);

    // Match Bevy's pre-exposed lighting convention: scale by exposure relative to the BLENDER baseline.
    let exposure_ratio = view.exposure / EXPOSURE_BLENDER;
    return vec4(color * exposure_ratio, final_pbr.albedo.a);
}
