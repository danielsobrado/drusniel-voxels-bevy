// Grass prepass shader - handles depth/shadows with alpha mask
// Must apply same wind animation as main grass.wgsl shader

#import bevy_pbr::mesh_functions::{get_world_from_local, mesh_position_local_to_clip}
#import bevy_pbr::prepass_io::VertexOutput

struct GrassMaterial {
    base_color: vec4<f32>,
    tip_color: vec4<f32>,
    wind_strength: f32,
    wind_speed: f32,
    wind_scale: f32,
    time: f32,
};

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> material: GrassMaterial;

// Noise functions - must match main shader exactly
fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);

    let a = hash(i);
    let b = hash(i + vec2<f32>(1.0, 0.0));
    let c = hash(i + vec2<f32>(0.0, 1.0));
    let d = hash(i + vec2<f32>(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pos = p;

    for (var i = 0; i < 3; i++) {
        value += amplitude * noise(pos * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    return value;
}

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
};

@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
    var out: VertexOutput;

    // Get transform for this instance
    let model = get_world_from_local(vertex.instance_index);

    // Calculate world position for wind sampling
    var local_pos = vec4<f32>(vertex.position, 1.0);
    let world_pos = model * local_pos;

    // Wind effect - MUST match main shader exactly
    let height_factor = 1.0 - vertex.uv.y;
    let height_factor_smooth = height_factor * height_factor;

    let phase_offset = hash(world_pos.xz * 7.3) * 6.28;
    let time_with_phase = material.time + phase_offset;

    let wind_sample_pos = world_pos.xz * material.wind_scale + time_with_phase * material.wind_speed;
    let wind_offset = fbm(wind_sample_pos) * 2.0 - 1.0;

    let gust_pos = world_pos.xz * 0.015 + material.time * 0.4;
    let gust = noise(gust_pos) * 2.0 - 1.0;
    let gust_direction = vec2<f32>(0.7, 0.4);

    let wind_x = wind_offset * material.wind_strength + gust * gust_direction.x * 0.3;
    let wind_z = wind_offset * material.wind_strength * 0.6 + gust * gust_direction.y * 0.3;

    local_pos.x += wind_x * height_factor_smooth;
    local_pos.z += wind_z * height_factor_smooth;
    local_pos.y -= abs(wind_x + wind_z) * 0.1 * height_factor_smooth;

    // Transform to clip space
    out.position = mesh_position_local_to_clip(model, local_pos);

    // Output world position and normal for prepass
    out.world_position = model * local_pos;
    out.world_normal = normalize((model * vec4<f32>(vertex.normal, 0.0)).xyz);
    out.uv = vertex.uv;

    return out;
}

// Alpha mask function - must match main shader exactly
fn blade_alpha(uv: vec2<f32>) -> f32 {
    let height = 1.0 - uv.y;
    let blade_width = mix(0.5, 0.15, height * height);
    let center_dist = abs(uv.x - 0.5);
    let edge = smoothstep(blade_width, blade_width * 0.6, center_dist);
    let tip_taper = smoothstep(0.0, 0.1, 1.0 - height);
    return edge * tip_taper;
}

@fragment
fn fragment(input: VertexOutput) {
    let alpha = blade_alpha(input.uv);
    // Discard fragments below alpha threshold (matches AlphaMode::Mask(0.5))
    if alpha < 0.5 {
        discard;
    }
    // Prepass doesn't need to output color, just depth (implicit via position)
}
