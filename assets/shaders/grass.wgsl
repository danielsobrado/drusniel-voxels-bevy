// Grass wind shader - Valheim-style swaying animation
// Uses Bevy 0.17 Material system with mesh_functions import
// Pattern based on assets/shaders/custom_vertex_attribute.wgsl from Bevy examples

#import bevy_pbr::mesh_functions::{get_world_from_local, mesh_position_local_to_clip}

struct GrassMaterial {
    base_color: vec4<f32>,
    tip_color: vec4<f32>,
    wind_strength: f32,
    wind_speed: f32,
    wind_scale: f32,
    time: f32,
};

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> material: GrassMaterial;

// Simple noise function for wind variation
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

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
    var out: VertexOutput;

    // Get transform for this instance
    let model = get_world_from_local(vertex.instance_index);
    
    // Calculate world position for wind sampling
    var local_pos = vec4<f32>(vertex.position, 1.0);
    let world_pos = model * local_pos;

    // Wind effect based on UV height (UV.y = 0 at tip, 1 at base)
    let height_factor = 1.0 - vertex.uv.y;
    let height_factor_smooth = height_factor * height_factor;

    // Sample wind using world position
    let wind_sample_pos = world_pos.xz * material.wind_scale + material.time * material.wind_speed;
    let wind_offset = fbm(wind_sample_pos) * 2.0 - 1.0;

    // Apply wind displacement
    local_pos.x += wind_offset * material.wind_strength * height_factor_smooth;
    local_pos.z += wind_offset * material.wind_strength * height_factor_smooth * 0.5;

    // Transform to clip space
    out.clip_position = mesh_position_local_to_clip(model, local_pos);
    out.uv = vertex.uv;
    
    // Gradient color from base to tip
    out.color = mix(material.tip_color, material.base_color, vertex.uv.y);

    return out;
}

struct FragmentInput {
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@fragment
fn fragment(input: FragmentInput) -> @location(0) vec4<f32> {
    return input.color;
}
