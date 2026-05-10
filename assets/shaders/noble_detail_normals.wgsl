// Ported from Noble Shaders by Belmu (GPL-3.0).
#define_import_path noble_detail_normals

#ifdef PREPASS_PIPELINE
#import bevy_render::globals::Globals
@group(0) @binding(1) var<uniform> globals: Globals;
#else
#import bevy_pbr::mesh_view_bindings::globals
#endif

#import bevy_water::water_bindings::material

fn noble_detail_hash12(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(269.5, 183.3))) * 43758.5453);
}

fn noble_detail_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (vec2<f32>(3.0) - 2.0 * f);
    let a = noble_detail_hash12(i);
    let b = noble_detail_hash12(i + vec2<f32>(1.0, 0.0));
    let c = noble_detail_hash12(i + vec2<f32>(0.0, 1.0));
    let d = noble_detail_hash12(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn noble_detail_fbm(p: vec2<f32>) -> f32 {
    return noble_detail_noise(p) * 0.65 + noble_detail_noise(p * 2.07 + vec2<f32>(17.0, 3.0)) * 0.35;
}

fn noble_detail_height(p: vec2<f32>) -> f32 {
    let scroll = max(material.wave_dir_b.y, 0.006);
    let time = globals.time;
    let layer_a = noble_detail_fbm(p * 1.8 + vec2<f32>(time * scroll, time * scroll * 0.75));
    let layer_b = noble_detail_fbm(p * 3.4 + vec2<f32>(-time * scroll * 0.5, time * scroll * 1.1));
    return layer_a * 0.55 + layer_b * 0.45;
}

fn noble_detail_normal(world_pos: vec3<f32>) -> vec3<f32> {
    let eps = 0.08;
    let scale = max(material.coord_scale.x * 7.5, 0.2);
    let p = world_pos.xz * scale;
    let h = noble_detail_height(p);
    let hx = noble_detail_height(p + vec2<f32>(eps, 0.0));
    let hz = noble_detail_height(p + vec2<f32>(0.0, eps));
    return normalize(vec3<f32>((h - hx) / eps, 1.0, (h - hz) / eps));
}

fn udnBlend(macro_normal: vec3<f32>, detail_normal: vec3<f32>, intensity: f32) -> vec3<f32> {
    let scaled = vec3<f32>(detail_normal.x * intensity, detail_normal.y, detail_normal.z * intensity);
    return normalize(vec3<f32>(macro_normal.x + scaled.x, macro_normal.y, macro_normal.z + scaled.z));
}

fn blendDetailNormals(macro_normal: vec3<f32>, world_pos: vec3<f32>, view_z: f32) -> vec3<f32> {
    let distance_fade = 1.0 - smoothstep(40.0, 80.0, abs(view_z));
    let encoded_intensity = max(material.wave_dir_b.x, 0.0);
    let fallback_intensity = max(material.amplitude * 0.24, 0.08);
    let intensity = select(fallback_intensity, encoded_intensity, encoded_intensity > 0.001) * distance_fade;
    if (intensity < 0.01) {
        return macro_normal;
    }
    return udnBlend(macro_normal, noble_detail_normal(world_pos), intensity);
}
