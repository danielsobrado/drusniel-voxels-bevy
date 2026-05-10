// Ported from Noble Shaders by Belmu (GPL-3.0).
#define_import_path noble_foam

#ifdef PREPASS_PIPELINE
#import bevy_render::globals::Globals
@group(0) @binding(1) var<uniform> globals: Globals;
#else
#import bevy_pbr::mesh_view_bindings::globals
#endif

#import bevy_water::water_bindings::material

fn noble_foam_hash2(p: vec2<f32>) -> vec2<f32> {
    let k = vec2<f32>(0.3183099, 0.3678794);
    var n = fract(p * k + k.yx);
    return fract(n * (n.yx + k) * 17.0);
}

fn noble_voronoi(p: vec2<f32>) -> f32 {
    let cell = floor(p);
    let frac_p = fract(p);
    var min_dist = 1.0;

    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let neighbor = vec2<f32>(f32(x), f32(y));
            let point = noble_foam_hash2(cell + neighbor);
            min_dist = min(min_dist, length(neighbor + point - frac_p));
        }
    }

    return min_dist;
}

fn noble_foam_noise(p: vec2<f32>) -> f32 {
    let large = 1.0 - noble_voronoi(p * 0.5);
    let medium = 1.0 - noble_voronoi(p);
    let small = 1.0 - noble_voronoi(p * 2.0);
    return large * 0.4 + medium * 0.4 + small * 0.2;
}

fn calculateFoamTexture(position: vec2<f32>, foam_amount: f32, crest_amount: f32) -> vec4<f32> {
    if (foam_amount < 0.01 && crest_amount < 0.01) {
        return vec4<f32>(0.0);
    }

    let preset_scale = max(material.coord_scale.x * 12.0, 0.25);
    let intensity = max(material.amplitude * 0.35, 0.18);
    let edge_sharpness = clamp(abs(material.edge_scale) * 0.18, 0.035, 0.24);
    let time = globals.time;
    let drift = vec2<f32>(time * 0.08, time * 0.035);
    let animated_pos = position * preset_scale + drift;
    let pattern = noble_foam_noise(animated_pos);
    let total_amount = saturate(foam_amount + crest_amount * 0.65);
    let threshold = 1.0 - total_amount;
    let foam_value = smoothstep(threshold, threshold + edge_sharpness, pattern);
    let sparkle = pow(max(noble_voronoi(position * preset_scale * 5.0 + vec2<f32>(time * 1.3)), 0.0), 8.0) * foam_value;
    let color = vec3<f32>(0.88, 0.96, 1.0) * (foam_value + sparkle * 0.25) * intensity;
    return vec4<f32>(color, foam_value);
}
