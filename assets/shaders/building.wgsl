// Building PBR shader - Full PBR for RTX 40xx
// Supports: albedo, normal, roughness, AO, metallic (optional), parallax mapping
// Texture samples per fragment: 15-18 (triplanar × maps)
// Target: ~500 building pieces, 2ms frame budget

#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::mesh_view_bindings::view

struct BuildingUniforms {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    parallax_scale: f32,
    parallax_steps: u32,
};

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: BuildingUniforms;

// Wood plank textures (material 0)
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var wood_albedo: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var tex_sampler: sampler;
@group(#{MATERIAL_BIND_GROUP}) @binding(3) var wood_normal: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(4) var wood_roughness: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(5) var wood_ao: texture_2d<f32>;

// Stone brick textures (material 1)
// @group(#{MATERIAL_BIND_GROUP}) @binding(6) var stone_albedo: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(7) var stone_normal: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(8) var stone_roughness: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(9) var stone_ao: texture_2d<f32>;

// Metal plate textures (material 2) - includes metallic
// @group(#{MATERIAL_BIND_GROUP}) @binding(10) var metal_albedo: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(11) var metal_normal: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(12) var metal_roughness: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(13) var metal_ao: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(14) var metal_metallic: texture_2d<f32>;

// Thatch textures (material 3)
// @group(#{MATERIAL_BIND_GROUP}) @binding(15) var thatch_albedo: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(16) var thatch_normal: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(17) var thatch_roughness: texture_2d<f32>;
// @group(#{MATERIAL_BIND_GROUP}) @binding(18) var thatch_ao: texture_2d<f32>;

// PBR sample result
struct PbrSample {
    albedo: vec4<f32>,
    normal: vec3<f32>,
    roughness: f32,
    ao: f32,
    metallic: f32,
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

// Parallax occlusion mapping - iterate to find actual surface
fn parallax_offset(uv: vec2<f32>, view_dir: vec3<f32>, normal_tex: texture_2d<f32>, parallax_scale: f32) -> vec2<f32> {
    let num_steps = uniforms.parallax_steps;
    let step_size = 1.0 / f32(num_steps);

    var current_uv = uv;
    var current_depth = 0.0;
    let delta_uv = view_dir.xy * parallax_scale / f32(num_steps);

    for (var i = 0u; i < num_steps; i++) {
        let normal_sample = textureSample(normal_tex, tex_sampler, current_uv).rgb;
        let unpacked = unpack_normal(normal_sample);
        // Height derived from normal: flat = high (1.0), steep = low (0.0)
        let height = unpacked.z * 0.5 + 0.5;

        if (current_depth > height) {
            break;
        }

        current_uv -= delta_uv;
        current_depth += step_size;
    }

    return current_uv;
}

// Sample all PBR textures for wood (material 0)
fn sample_wood_pbr(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, wn: vec3<f32>, view_dir: vec3<f32>) -> PbrSample {
    // Apply parallax to each projection
    let p_yz = parallax_offset(uv_yz, view_dir, wood_normal, 0.03);
    let p_xz = parallax_offset(uv_xz, view_dir, wood_normal, 0.03);
    let p_xy = parallax_offset(uv_xy, view_dir, wood_normal, 0.03);

    // Triplanar sample all maps
    let albedo = textureSample(wood_albedo, tex_sampler, p_yz) * w.x +
                 textureSample(wood_albedo, tex_sampler, p_xz) * w.y +
                 textureSample(wood_albedo, tex_sampler, p_xy) * w.z;

    let nx = textureSample(wood_normal, tex_sampler, p_yz).rgb;
    let ny = textureSample(wood_normal, tex_sampler, p_xz).rgb;
    let nz = textureSample(wood_normal, tex_sampler, p_xy).rgb;
    let n0 = reorient_normal(unpack_normal(nx), wn, 0);
    let n1 = reorient_normal(unpack_normal(ny), wn, 1);
    let n2 = reorient_normal(unpack_normal(nz), wn, 2);
    let normal = normalize(n0 * w.x + n1 * w.y + n2 * w.z);

    let roughness = (textureSample(wood_roughness, tex_sampler, p_yz).r * w.x +
                     textureSample(wood_roughness, tex_sampler, p_xz).r * w.y +
                     textureSample(wood_roughness, tex_sampler, p_xy).r * w.z);

    let ao = (textureSample(wood_ao, tex_sampler, p_yz).r * w.x +
              textureSample(wood_ao, tex_sampler, p_xz).r * w.y +
              textureSample(wood_ao, tex_sampler, p_xy).r * w.z);

    return PbrSample(albedo, normal, roughness, ao, 0.0);
}

// Sample all PBR textures for stone (material 1)
fn sample_stone_pbr(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, wn: vec3<f32>, view_dir: vec3<f32>) -> PbrSample {
    let p_yz = parallax_offset(uv_yz, view_dir, stone_normal, 0.05);
    let p_xz = parallax_offset(uv_xz, view_dir, stone_normal, 0.05);
    let p_xy = parallax_offset(uv_xy, view_dir, stone_normal, 0.05);

    let albedo = textureSample(stone_albedo, tex_sampler, p_yz) * w.x +
                 textureSample(stone_albedo, tex_sampler, p_xz) * w.y +
                 textureSample(stone_albedo, tex_sampler, p_xy) * w.z;

    let nx = textureSample(stone_normal, tex_sampler, p_yz).rgb;
    let ny = textureSample(stone_normal, tex_sampler, p_xz).rgb;
    let nz = textureSample(stone_normal, tex_sampler, p_xy).rgb;
    let n0 = reorient_normal(unpack_normal(nx), wn, 0);
    let n1 = reorient_normal(unpack_normal(ny), wn, 1);
    let n2 = reorient_normal(unpack_normal(nz), wn, 2);
    let normal = normalize(n0 * w.x + n1 * w.y + n2 * w.z);

    let roughness = (textureSample(stone_roughness, tex_sampler, p_yz).r * w.x +
                     textureSample(stone_roughness, tex_sampler, p_xz).r * w.y +
                     textureSample(stone_roughness, tex_sampler, p_xy).r * w.z);

    let ao = (textureSample(stone_ao, tex_sampler, p_yz).r * w.x +
              textureSample(stone_ao, tex_sampler, p_xz).r * w.y +
              textureSample(stone_ao, tex_sampler, p_xy).r * w.z);

    return PbrSample(albedo, normal, roughness, ao, 0.0);
}

// Sample all PBR textures for metal (material 2) - includes metallic
fn sample_metal_pbr(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, wn: vec3<f32>, view_dir: vec3<f32>) -> PbrSample {
    let p_yz = parallax_offset(uv_yz, view_dir, metal_normal, 0.02);
    let p_xz = parallax_offset(uv_xz, view_dir, metal_normal, 0.02);
    let p_xy = parallax_offset(uv_xy, view_dir, metal_normal, 0.02);

    let albedo = textureSample(metal_albedo, tex_sampler, p_yz) * w.x +
                 textureSample(metal_albedo, tex_sampler, p_xz) * w.y +
                 textureSample(metal_albedo, tex_sampler, p_xy) * w.z;

    let nx = textureSample(metal_normal, tex_sampler, p_yz).rgb;
    let ny = textureSample(metal_normal, tex_sampler, p_xz).rgb;
    let nz = textureSample(metal_normal, tex_sampler, p_xy).rgb;
    let n0 = reorient_normal(unpack_normal(nx), wn, 0);
    let n1 = reorient_normal(unpack_normal(ny), wn, 1);
    let n2 = reorient_normal(unpack_normal(nz), wn, 2);
    let normal = normalize(n0 * w.x + n1 * w.y + n2 * w.z);

    let roughness = (textureSample(metal_roughness, tex_sampler, p_yz).r * w.x +
                     textureSample(metal_roughness, tex_sampler, p_xz).r * w.y +
                     textureSample(metal_roughness, tex_sampler, p_xy).r * w.z);

    let ao = (textureSample(metal_ao, tex_sampler, p_yz).r * w.x +
              textureSample(metal_ao, tex_sampler, p_xz).r * w.y +
              textureSample(metal_ao, tex_sampler, p_xy).r * w.z);

    let metallic = (textureSample(metal_metallic, tex_sampler, p_yz).r * w.x +
                    textureSample(metal_metallic, tex_sampler, p_xz).r * w.y +
                    textureSample(metal_metallic, tex_sampler, p_xy).r * w.z);

    return PbrSample(albedo, normal, roughness, ao, metallic);
}

// Sample all PBR textures for thatch (material 3)
fn sample_thatch_pbr(uv_yz: vec2<f32>, uv_xz: vec2<f32>, uv_xy: vec2<f32>, w: vec3<f32>, wn: vec3<f32>, view_dir: vec3<f32>) -> PbrSample {
    let p_yz = parallax_offset(uv_yz, view_dir, thatch_normal, 0.04);
    let p_xz = parallax_offset(uv_xz, view_dir, thatch_normal, 0.04);
    let p_xy = parallax_offset(uv_xy, view_dir, thatch_normal, 0.04);

    let albedo = textureSample(thatch_albedo, tex_sampler, p_yz) * w.x +
                 textureSample(thatch_albedo, tex_sampler, p_xz) * w.y +
                 textureSample(thatch_albedo, tex_sampler, p_xy) * w.z;

    let nx = textureSample(thatch_normal, tex_sampler, p_yz).rgb;
    let ny = textureSample(thatch_normal, tex_sampler, p_xz).rgb;
    let nz = textureSample(thatch_normal, tex_sampler, p_xy).rgb;
    let n0 = reorient_normal(unpack_normal(nx), wn, 0);
    let n1 = reorient_normal(unpack_normal(ny), wn, 1);
    let n2 = reorient_normal(unpack_normal(nz), wn, 2);
    let normal = normalize(n0 * w.x + n1 * w.y + n2 * w.z);

    let roughness = (textureSample(thatch_roughness, tex_sampler, p_yz).r * w.x +
                     textureSample(thatch_roughness, tex_sampler, p_xz).r * w.y +
                     textureSample(thatch_roughness, tex_sampler, p_xy).r * w.z);

    let ao = (textureSample(thatch_ao, tex_sampler, p_yz).r * w.x +
              textureSample(thatch_ao, tex_sampler, p_xz).r * w.y +
              textureSample(thatch_ao, tex_sampler, p_xy).r * w.z);

    return PbrSample(albedo, normal, roughness, ao, 0.0);
}

// Cook-Torrance BRDF components
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

    // Material weights from vertex colors (r=wood, g=stone, b=metal, a=thatch)
    let mat_weights = in.color;
    let w_total = dot(mat_weights, vec4<f32>(1.0));
    let w = mat_weights / max(w_total, 0.001);

    let weights = triplanar_weights(world_normal);
    let uv_yz = compute_uv(world_pos.yz);
    let uv_xz = compute_uv(world_pos.xz);
    let uv_xy = compute_uv(world_pos.xy);

    var final_pbr = PbrSample(vec4(0.0), vec3(0.0), 0.0, 0.0, 0.0);

    // Sample each material weighted by vertex colors
    if (w.x > 0.001) {
        let pbr = sample_wood_pbr(uv_yz, uv_xz, uv_xy, weights, world_normal, view_dir);
        final_pbr.albedo += pbr.albedo * w.x;
        final_pbr.normal += pbr.normal * w.x;
        final_pbr.roughness += pbr.roughness * w.x;
        final_pbr.ao += pbr.ao * w.x;
    }

    if (w.y > 0.001) {
        let pbr = sample_stone_pbr(uv_yz, uv_xz, uv_xy, weights, world_normal, view_dir);
        final_pbr.albedo += pbr.albedo * w.y;
        final_pbr.normal += pbr.normal * w.y;
        final_pbr.roughness += pbr.roughness * w.y;
        final_pbr.ao += pbr.ao * w.y;
    }

    if (w.z > 0.001) {
        let pbr = sample_metal_pbr(uv_yz, uv_xz, uv_xy, weights, world_normal, view_dir);
        final_pbr.albedo += pbr.albedo * w.z;
        final_pbr.normal += pbr.normal * w.z;
        final_pbr.roughness += pbr.roughness * w.z;
        final_pbr.ao += pbr.ao * w.z;
        final_pbr.metallic += pbr.metallic * w.z;
    }

    if (w.w > 0.001) {
        let pbr = sample_thatch_pbr(uv_yz, uv_xz, uv_xy, weights, world_normal, view_dir);
        final_pbr.albedo += pbr.albedo * w.w;
        final_pbr.normal += pbr.normal * w.w;
        final_pbr.roughness += pbr.roughness * w.w;
        final_pbr.ao += pbr.ao * w.w;
    }

    let albedo = final_pbr.albedo.rgb * uniforms.base_color.rgb;
    let normal = normalize(final_pbr.normal);
    let roughness = clamp(final_pbr.roughness, 0.04, 1.0);
    let ao = final_pbr.ao;
    let metallic = final_pbr.metallic;

    // PBR lighting
    let light_dir = normalize(vec3(0.4, 0.8, 0.3));
    let half_dir = normalize(light_dir + view_dir);

    let n_dot_l = max(dot(normal, light_dir), 0.0);
    let n_dot_v = max(dot(normal, view_dir), 0.0);
    let n_dot_h = max(dot(normal, half_dir), 0.0);
    let h_dot_v = max(dot(half_dir, view_dir), 0.0);

    // Fresnel reflectance at normal incidence
    let f0 = mix(vec3(0.04), albedo, metallic);

    // Cook-Torrance BRDF
    let d = distribution_ggx(n_dot_h, roughness);
    let g = geometry_smith(n_dot_v, n_dot_l, roughness);
    let f = fresnel_schlick(h_dot_v, f0);

    let specular = (d * g * f) / max(4.0 * n_dot_v * n_dot_l, 0.001);

    // Energy conservation
    let k_s = f;
    let k_d = (1.0 - k_s) * (1.0 - metallic);

    // Combine diffuse and specular
    let light_color = vec3(1.0, 0.95, 0.9); // Warm sunlight
    let ambient = vec3(0.15, 0.17, 0.2) * ao; // Cool ambient with AO

    let lo = (k_d * albedo / 3.14159265 + specular) * light_color * n_dot_l;
    let color = ambient * albedo + lo;

    // Match Bevy's pre-exposed lighting convention: scale by exposure relative to the BLENDER baseline.
    let exposure_ratio = view.exposure / EXPOSURE_BLENDER;
    return vec4(color * exposure_ratio, final_pbr.albedo.a);
}
