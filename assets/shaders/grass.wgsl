// Grass wind shader - Valheim-style swaying animation
// Uses Bevy 0.17 Material system with mesh_functions import
// Pattern based on assets/shaders/custom_vertex_attribute.wgsl from Bevy examples

#import bevy_pbr::mesh_view_bindings::view
#import bevy_pbr::mesh_functions::{get_world_from_local, mesh_position_local_to_clip}

// Baseline exposure used by Bevy when no explicit camera exposure is set (EV100_BLENDER = 9.7).
const EXPOSURE_BLENDER: f32 = 0.0010019079;

struct GrassMaterial {
    base_color: vec4<f32>,
    tip_color: vec4<f32>,
    wind_strength: f32,
    wind_speed: f32,
    wind_scale: f32,
    time: f32,
    fog_start: f32,
    fog_end: f32,
    aerial_strength: f32,
    _padding: f32,
    fog_color: vec4<f32>,
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
    @location(2) world_position: vec3<f32>,
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

    // Per-instance phase offset based on world position for desynchronized movement
    let phase_offset = hash(world_pos.xz * 7.3) * 6.28;
    let time_with_phase = material.time + phase_offset;

    // Primary wind - local turbulence
    let wind_sample_pos = world_pos.xz * material.wind_scale + time_with_phase * material.wind_speed;
    let wind_offset = fbm(wind_sample_pos) * 2.0 - 1.0;

    // Secondary gust - slower, larger scale, directional
    let gust_pos = world_pos.xz * 0.015 + material.time * 0.4;
    let gust = noise(gust_pos) * 2.0 - 1.0;
    let gust_direction = vec2<f32>(0.7, 0.4); // Dominant wind direction

    // Combined displacement
    let wind_x = wind_offset * material.wind_strength + gust * gust_direction.x * 0.3;
    let wind_z = wind_offset * material.wind_strength * 0.6 + gust * gust_direction.y * 0.3;

    // Apply wind displacement with height weighting
    local_pos.x += wind_x * height_factor_smooth;
    local_pos.z += wind_z * height_factor_smooth;
    // Subtle Y compression when bent (grass bends, doesn't stretch)
    local_pos.y -= abs(wind_x + wind_z) * 0.1 * height_factor_smooth;

    // Transform to clip space
    out.clip_position = mesh_position_local_to_clip(model, local_pos);
    out.uv = vertex.uv;
    // Pass final world position for fog calculations
    out.world_position = (model * local_pos).xyz;

    // Gradient color from base to tip (bias toward tip to reduce base banding)
    let base_weight = pow(clamp(vertex.uv.y, 0.0, 1.0), 1.6);
    out.color = mix(material.tip_color, material.base_color, base_weight);

    return out;
}

struct FragmentInput {
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) world_position: vec3<f32>,
};

// Compute procedural grass blade alpha mask
// UV.y: 0 at tip, 1 at base
// UV.x: 0 to 1 across width
fn blade_alpha(uv: vec2<f32>) -> f32 {
    // Height from base (0 at base, 1 at tip)
    let height = 1.0 - uv.y;

    // Blade width narrows toward tip
    let blade_width = mix(0.5, 0.15, height * height);

    // Distance from center
    let center_dist = abs(uv.x - 0.5);

    // Soft edge falloff
    let edge = smoothstep(blade_width, blade_width * 0.6, center_dist);

    // Taper at very tip
    let tip_taper = smoothstep(0.0, 0.1, 1.0 - height);

    return edge * tip_taper;
}

@fragment
fn fragment(input: FragmentInput) -> @location(0) vec4<f32> {
    let alpha = blade_alpha(input.uv);

    // Aerial perspective - blend toward fog color based on distance
    let distance = length(view.world_position - input.world_position);
    let fog_range = max(material.fog_end - material.fog_start, 1.0);
    let fog_factor = clamp((distance - material.fog_start) / fog_range, 0.0, 1.0) * material.aerial_strength;
    let color = mix(input.color.rgb, material.fog_color.rgb, fog_factor);

    return vec4<f32>(color, alpha);
}
