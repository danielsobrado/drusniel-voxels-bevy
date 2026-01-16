// XeGTAO Prepass - Generates depth + normals buffer for GTAO
// Based on Intel's XeGTAO implementation
// Ported to WGSL for Bevy 0.17

#import bevy_pbr::mesh_bindings::mesh
#import bevy_pbr::mesh_functions::{get_world_from_local, mesh_position_local_to_clip}
#import bevy_pbr::view_transformations::position_world_to_clip

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) view_depth: f32,
};

@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
    var out: VertexOutput;
    
    let world_from_local = get_world_from_local(vertex.instance_index);
    let world_position = (world_from_local * vec4<f32>(vertex.position, 1.0)).xyz;
    let world_normal = normalize((world_from_local * vec4<f32>(vertex.normal, 0.0)).xyz);
    
    out.world_position = world_position;
    out.world_normal = world_normal;
    out.clip_position = mesh_position_local_to_clip(world_from_local, vec4<f32>(vertex.position, 1.0));
    out.view_depth = out.clip_position.z;
    
    return out;
}

struct FragmentOutput {
    @location(0) packed_normal_depth: vec4<f32>,
};

@fragment
fn fragment(in: VertexOutput) -> FragmentOutput {
    var out: FragmentOutput;
    
    // Pack view-space normal (xyz) and depth (w) for GTAO
    let view_normal = normalize(in.world_normal);
    out.packed_normal_depth = vec4<f32>(view_normal * 0.5 + 0.5, in.view_depth);
    
    return out;
}
