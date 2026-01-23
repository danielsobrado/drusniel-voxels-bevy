// Billboard shader - Axial/cylindrical billboards for tree LOD
// Rotates only around Y-axis to maintain silhouette authenticity
// Uses alpha-cutoff for clean tree edges

#import bevy_pbr::mesh_view_bindings::view
#import bevy_pbr::mesh_functions::{get_world_from_local, mesh_position_local_to_clip}

struct BillboardUniforms {
    size: vec2<f32>,
    alpha_cutoff: f32,
    wind_strength: f32,
    time: f32,
    fog_start: f32,
    fog_end: f32,
    _padding: f32,
    fog_color: vec4<f32>,
};

@group(2) @binding(0) var<uniform> uniforms: BillboardUniforms;
@group(2) @binding(1) var billboard_texture: texture_2d<f32>;
@group(2) @binding(2) var billboard_sampler: sampler;

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) world_position: vec3<f32>,
    @location(2) fog_factor: f32,
};

// Simple noise for subtle wind sway
fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
    var out: VertexOutput;

    // Get instance transform
    let model = get_world_from_local(vertex.instance_index);

    // Extract billboard center position from model matrix (translation column)
    let billboard_center = vec3<f32>(model[3][0], model[3][1], model[3][2]);

    // Extract scale from model matrix
    let scale_x = length(vec3<f32>(model[0][0], model[0][1], model[0][2]));
    let scale_y = length(vec3<f32>(model[1][0], model[1][1], model[1][2]));

    // Calculate direction to camera (horizontal only for axial billboard)
    let to_camera = view.world_position - billboard_center;
    var to_camera_xz = vec2<f32>(to_camera.x, to_camera.z);
    let len = length(to_camera_xz);
    if len > 0.001 {
        to_camera_xz = to_camera_xz / len;
    } else {
        to_camera_xz = vec2<f32>(0.0, 1.0);
    }

    // Construct Y-axis rotation matrix (axial/cylindrical billboard)
    // This makes the billboard face the camera but stay upright
    let right = vec3<f32>(to_camera_xz.y, 0.0, -to_camera_xz.x);
    let up = vec3<f32>(0.0, 1.0, 0.0);
    let forward = vec3<f32>(to_camera_xz.x, 0.0, to_camera_xz.y);

    // Scale vertex position by billboard size (from transform scale)
    var local_pos = vertex.position;
    local_pos.x *= scale_x;
    local_pos.y *= scale_y;

    // Subtle wind sway at top of billboard
    let phase = hash(billboard_center.xz * 7.3) * 6.28;
    let sway = sin(uniforms.time * 1.5 + phase) * uniforms.wind_strength * vertex.position.y;
    local_pos.x += sway;

    // Transform to world space using billboard orientation
    let world_pos = billboard_center +
                    right * local_pos.x +
                    up * local_pos.y +
                    forward * local_pos.z;

    out.world_position = world_pos;
    out.clip_position = view.clip_from_world * vec4<f32>(world_pos, 1.0);
    out.uv = vertex.uv;

    // Pre-calculate fog factor for aerial perspective
    let distance = length(view.world_position - world_pos);
    let fog_range = max(uniforms.fog_end - uniforms.fog_start, 1.0);
    out.fog_factor = clamp((distance - uniforms.fog_start) / fog_range, 0.0, 1.0);

    return out;
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample billboard texture
    let tex_color = textureSample(billboard_texture, billboard_sampler, in.uv);

    // Alpha test with cutoff
    if tex_color.a < uniforms.alpha_cutoff {
        discard;
    }

    // Apply aerial perspective fog
    let final_color = mix(tex_color.rgb, uniforms.fog_color.rgb, in.fog_factor * 0.5);

    return vec4<f32>(final_color, tex_color.a);
}
