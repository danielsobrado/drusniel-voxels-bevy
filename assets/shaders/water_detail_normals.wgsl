// Water Detail Normal Maps
// Adds fine-scale ripple detail on top of macro Gerstner wave normals
// via two scrolling tiling normal map textures blended with UDN technique.

#define_import_path water_detail_normals

#import bevy_water::water_bindings

// Detail normal map textures (bound by water material)
@group(#{MATERIAL_BIND_GROUP}) @binding(101) var detail_normal_a: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(102) var detail_normal_b: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(103) var detail_sampler: sampler;

// Unpack normal from [0,1] texture to [-1,1] range
fn unpack_normal(sampled: vec3<f32>) -> vec3<f32> {
    return normalize(sampled * 2.0 - 1.0);
}

// UDN (Unreal Developer Network) normal blending
// Blends detail normals into a macro normal while preserving correct orientation
fn udn_blend(macro_n: vec3<f32>, detail_n: vec3<f32>) -> vec3<f32> {
    return normalize(vec3<f32>(
        macro_n.x + detail_n.x,
        macro_n.y,
        macro_n.z + detail_n.z
    ));
}

// Blend two scrolling detail normal maps with the macro wave normal
// Returns the combined world-space normal
fn blend_detail_normals(
    macro_normal: vec3<f32>,
    world_pos: vec3<f32>,
    time: f32,
    scale_a: f32,
    scale_b: f32,
    scroll_speed: f32,
    intensity: f32,
    camera_distance: f32,
) -> vec3<f32> {
    // Distance-based fade: detail normals are only visible up close
    // Fade starts at 40m, fully gone at 80m
    let distance_fade = 1.0 - smoothstep(40.0, 80.0, camera_distance);
    let effective_intensity = intensity * distance_fade;

    if (effective_intensity < 0.01) {
        return macro_normal;
    }

    // Two layers scrolling in different directions for non-repetitive appearance
    let uv_a = world_pos.xz * scale_a + vec2<f32>(time * scroll_speed, time * scroll_speed * 0.75);
    let uv_b = world_pos.xz * scale_b + vec2<f32>(-time * scroll_speed * 0.5, time * scroll_speed * 1.1);

    let normal_a = unpack_normal(textureSample(detail_normal_a, detail_sampler, uv_a).xyz);
    let normal_b = unpack_normal(textureSample(detail_normal_b, detail_sampler, uv_b).xyz);

    // Average the two detail layers, then scale by intensity
    let combined_detail = normalize(normal_a + normal_b);
    let scaled_detail = vec3<f32>(
        combined_detail.x * effective_intensity,
        1.0,
        combined_detail.z * effective_intensity
    );

    // Blend with macro normal using UDN
    return udn_blend(macro_normal, normalize(scaled_detail));
}
