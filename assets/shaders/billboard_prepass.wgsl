// Billboard prepass shader - depth/normal pass for billboard LOD trees.
// Must match billboard.wgsl vertex deformation and alpha cutoff behavior.

#import bevy_pbr::mesh_view_bindings::view
#import bevy_pbr::mesh_functions::get_world_from_local
#import bevy_pbr::prepass_io::{Vertex, VertexOutput}

struct BillboardUniforms {
    size: vec2<f32>,
    alpha_cutoff: f32,
    _padding0: f32,
    // x = wind strength, y = bend strength, z = leaf flutter strength, w = leaf flutter speed
    wind_params: vec4<f32>,
    // x = time, y = fog start, z = fog end, w = reserved
    scene_params: vec4<f32>,
    fog_color: vec4<f32>,
};

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: BillboardUniforms;
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var billboard_texture: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var billboard_sampler: sampler;

fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

const SEGMENTS: u32 = 10u;
const INV_SEGMENTS: f32 = 1.0 / 10.0;

@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
    var out: VertexOutput;

    // Get instance transform
    let model = get_world_from_local(vertex.instance_index);

    // Extract billboard center from instance transform
    let billboard_center = vec3<f32>(model[3][0], model[3][1], model[3][2]);

    // Extract scale from instance transform
    let scale_x = length(vec3<f32>(model[0][0], model[0][1], model[0][2]));
    let scale_y = length(vec3<f32>(model[1][0], model[1][1], model[1][2]));

    // Face camera around Y only (axial billboard)
    let to_camera = view.world_position - billboard_center;
    var to_camera_xz = vec2<f32>(to_camera.x, to_camera.z);
    let len = length(to_camera_xz);
    if len > 0.001 {
        to_camera_xz = to_camera_xz / len;
    } else {
        to_camera_xz = vec2<f32>(0.0, 1.0);
    }

    let right = vec3<f32>(to_camera_xz.y, 0.0, -to_camera_xz.x);
    let up = vec3<f32>(0.0, 1.0, 0.0);
    let forward = vec3<f32>(to_camera_xz.x, 0.0, to_camera_xz.y);

    var local_pos = vertex.position;
    local_pos.x *= scale_x;
    local_pos.y *= scale_y;

    let wind_strength = uniforms.wind_params.x;
    let bend_strength = uniforms.wind_params.y;
    let leaf_flutter_strength = uniforms.wind_params.z;
    let leaf_flutter_speed = uniforms.wind_params.w;
    let time = uniforms.scene_params.x;

    let phase = hash(billboard_center.xz * 7.3) * 6.28;
    let height01 = clamp(vertex.position.y, 0.0, 1.0);
    for (var i: u32 = 0u; i < SEGMENTS; i = i + 1u) {
        let seg_start = f32(i) * INV_SEGMENTS;
        let seg_end = f32(i + 1u) * INV_SEGMENTS;
        if (height01 <= seg_start) {
            break;
        }

        let seg_t = clamp((height01 - seg_start) / max(seg_end - seg_start, 0.0001), 0.0, 1.0);
        let seg_weight = f32(i + 1u) * INV_SEGMENTS;
        let seg_phase = time * 1.35 + phase + f32(i) * 0.35;
        let seg_angle = sin(seg_phase) * wind_strength * bend_strength * seg_weight;
        let seg_len = (seg_end - seg_start) * scale_y * seg_t;

        local_pos.x += sin(seg_angle) * seg_len;
        local_pos.y -= (1.0 - cos(seg_angle)) * seg_len;
    }

    let uv_len = clamp(length(vertex.uv) * 0.70710677, 0.0, 1.0);
    let leaf_weight = uv_len * uv_len * height01;
    let flutter_phase = time * leaf_flutter_speed + phase * 1.9 + dot(vertex.uv, vec2<f32>(21.7, 14.3));
    let flutter = sin(flutter_phase) * cos(flutter_phase * 1.37);
    local_pos.x += flutter * wind_strength * leaf_flutter_strength * leaf_weight * scale_x;
    local_pos.z += flutter * wind_strength * leaf_flutter_strength * leaf_weight * 0.05;

    let world_pos = billboard_center +
                    right * local_pos.x +
                    up * local_pos.y +
                    forward * local_pos.z;

    out.position = view.clip_from_world * vec4<f32>(world_pos, 1.0);
    out.world_position = vec4<f32>(world_pos, 1.0);
#ifdef NORMAL_PREPASS_OR_DEFERRED_PREPASS
    // Only valid for normal/deferred prepass variants.
    out.world_normal = normalize(forward);
#endif
    out.uv = vertex.uv;

    return out;
}

@fragment
fn fragment(input: VertexOutput) {
    let tex_color = textureSample(billboard_texture, billboard_sampler, input.uv);
    if tex_color.a < uniforms.alpha_cutoff {
        discard;
    }
}
