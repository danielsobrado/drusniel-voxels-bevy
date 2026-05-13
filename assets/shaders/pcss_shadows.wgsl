// PCSS utility module.
//
// This file is deliberately import-only. It must not declare fixed bind groups
// or fabricate shadow coordinates; the active material/shadow pipeline must
// provide real cascade coordinates and resource bindings before using it.

#define_import_path pcss_shadows

struct PcssUniforms {
    light_size: f32,
    blocker_search_samples: u32,
    pcf_samples: u32,
    min_penumbra_size: f32,
    max_penumbra_size: f32,
    padding: vec3<f32>,
};

const PCSS_PI: f32 = 3.14159265359;

fn pcss_vogel_disk_sample(sample_index: u32, sample_count: u32, phi: f32) -> vec2<f32> {
    let golden_angle = 2.4;
    let r = sqrt(f32(sample_index) + 0.5) / sqrt(f32(sample_count));
    let theta = f32(sample_index) * golden_angle + phi;
    return vec2<f32>(r * cos(theta), r * sin(theta));
}

fn pcss_penumbra_size(
    receiver_depth: f32,
    blocker_depth: f32,
    light_size: f32,
    min_penumbra_size: f32,
    max_penumbra_size: f32,
) -> f32 {
    let distance_ratio = max(receiver_depth - blocker_depth, 0.0) / max(blocker_depth, 0.0001);
    return clamp(light_size * distance_ratio, min_penumbra_size, max_penumbra_size);
}
