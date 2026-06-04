// Triplanar terrain vertex stage — GPU geomorph static seam weld (PR3).
//
// Modeled on assets/shaders/water_vertex.wgsl, the proven custom-vertex pattern on
// this Bevy 0.18 setup (it compiles for both the forward and prepass pipelines).
// Adds ATTRIBUTE_MORPH_TARGET at @location(8) and applies a STATIC weld in
// mesh-local space (same space + CHUNK_BOUNDARY_SCALE scaling as POSITION) before
// the world transform:
//
//     morphed_local = mix(position, morph_target.xyz, morph_target.w)
//
// `w` is baked per vertex (0 = interior / skirt, 1 = LOD-transition boundary). The
// weld is static for the lifespan of a mesh instance (a neighbor-LOD change re-meshes
// into a new asset), so applying the same morphed local position through the
// previous-frame model matrix yields correct motion vectors with no per-frame math.
//
// ⚠ NOT runtime-validated in this environment (no GPU / in-game). Only compiled and
// used when the morph gate is ON (VOXELS_TERRAIN_MORPH=1); default terrain keeps
// Bevy's stock vertex shader, so this file cannot affect the default render path.
// Must pass in-game Alt+F7 validation + the prepass/shadow spike (see
// docs/lod/gpu-terrain-geomorph-plan.md, decision D2) before relying on it.

#import bevy_pbr::{
    mesh_functions,
    view_transformations::position_world_to_clip,
}

#ifdef PREPASS_PIPELINE
#import bevy_pbr::prepass_io::{Vertex, VertexOutput}
#else
#import bevy_pbr::forward_io::{Vertex, VertexOutput}
#endif

@vertex
fn vertex(vertex: Vertex, @location(8) morph_target: vec4<f32>) -> VertexOutput {
    var out: VertexOutput;

    // Static seam weld in mesh-local space, before any transform.
    let morphed_position = mix(vertex.position, morph_target.xyz, morph_target.w);

    let model = mesh_functions::get_world_from_local(vertex.instance_index);

#ifdef PREPASS_PIPELINE
#ifdef NORMAL_PREPASS_OR_DEFERRED_PREPASS
    out.world_normal = mesh_functions::mesh_normal_local_to_world(
        vertex.normal,
        vertex.instance_index,
    );
#endif
#else
#ifdef VERTEX_NORMALS
    out.world_normal = mesh_functions::mesh_normal_local_to_world(
        vertex.normal,
        vertex.instance_index,
    );
#endif
#endif

    let world_position = mesh_functions::mesh_position_local_to_world(
        model,
        vec4<f32>(morphed_position, 1.0),
    );
    out.world_position = world_position;
    out.position = position_world_to_clip(world_position.xyz);

#ifdef VERTEX_UVS_A
    out.uv = vertex.uv;
#endif
#ifdef VERTEX_UVS_B
    out.uv_b = vertex.uv_b;
#endif
#ifdef VERTEX_TANGENTS
    out.world_tangent = mesh_functions::mesh_tangent_local_to_world(
        model,
        vertex.tangent,
        vertex.instance_index,
    );
#endif
#ifdef VERTEX_COLORS
    out.color = vertex.color;
#endif
#ifdef VERTEX_OUTPUT_INSTANCE_INDEX
    out.instance_index = vertex.instance_index;
#endif

#ifdef MOTION_VECTOR_PREPASS
    // Same static weld through the previous-frame model matrix → motion vectors
    // capture only object/camera motion, never the (frame-invariant) morph.
    out.previous_world_position = mesh_functions::mesh_position_local_to_world(
        mesh_functions::get_previous_world_from_local(vertex.instance_index),
        vec4<f32>(morphed_position, 1.0),
    );
#endif

    return out;
}
