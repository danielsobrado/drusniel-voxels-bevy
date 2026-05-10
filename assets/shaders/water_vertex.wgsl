#import bevy_pbr::{
	mesh_functions,
	skinning,
	view_transformations::position_world_to_clip,
}

#import bevy_water::water_functions as water_fn
#import bevy_water::water_bindings
#import gerstner_waves

#ifdef PREPASS_PIPELINE
#import bevy_pbr::prepass_io::{Vertex, VertexOutput}
#else
#import bevy_pbr::forward_io::{Vertex, VertexOutput}
#endif

#ifdef PREPASS_PIPELINE
#import bevy_render::globals::Globals
@group(0) @binding(1) var<uniform> globals_v: Globals;
#else
#import bevy_pbr::mesh_view_bindings::globals as globals_v
#endif

// Toggle bit magnitudes — must match `WaterShaderToggles` in `src/rendering/water.rs`.
const WATER_TOGGLE_VORONOI_FOAM_V: f32 = 20000.0;
const WATER_TOGGLE_GERSTNER_V: f32 = 10000.0;

@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
  var out: VertexOutput;

#ifdef SKINNED
  var model = skinning::skin_model(vertex.joint_indices, vertex.joint_weights);
#else
  var model = mesh_functions::get_world_from_local(vertex.instance_index);
#endif

#ifdef VERTEX_UVS
#ifdef SKINNED
  out.world_normal = skinning::skin_normals(model, vertex.normal);
#else
  out.world_normal = mesh_functions::mesh_normal_local_to_world(
		vertex.normal,
		vertex.instance_index
	);
#endif
#endif

  let world_position = mesh_functions::mesh_position_local_to_world(model, vec4<f32>(vertex.position, 1.0));

  // Add the wave height to the world position.
	var height = 0.0;
#ifdef DYN_WATER
  let w_pos = water_fn::uv_to_coord(vertex.uv);
  // Decode Gerstner toggle bit from the witchcraft alpha encoding (same scheme
  // as water_fragment.wgsl). The Voronoi-foam bit is fragment-only.
  let raw_edge_alpha_v = water_bindings::material.edge_color.a;
  let edge_after_foam_v = select(
    raw_edge_alpha_v,
    raw_edge_alpha_v - WATER_TOGGLE_VORONOI_FOAM_V,
    raw_edge_alpha_v >= WATER_TOGGLE_VORONOI_FOAM_V,
  );
  let gerstner_enabled_v = edge_after_foam_v >= WATER_TOGGLE_GERSTNER_V;
  if (gerstner_enabled_v) {
    let g_amp = max(water_bindings::material.amplitude, 0.05);
    let g_scale = max(water_bindings::material.coord_scale.x, 0.001);
    // bevy_water's `quality` is a shader_def, not a uniform field — pin Gerstner
    // wave_count at the max (4) when this branch runs.
    let g_count = 4u;
    let g_result = gerstner_waves::sum_gerstner_waves_limited(
      w_pos,
      globals_v.time,
      g_amp,
      g_scale,
      g_count,
    );
    // Use only the vertical component for surface displacement; horizontal
    // displacement would shift UVs and break the existing prepass/foam path.
    height = g_result.position.y;
  } else {
    height = water_fn::get_wave_height(w_pos);
  }
#endif

  out.world_position = world_position + vec4<f32>((out.world_normal * height), 0.);
  out.position = position_world_to_clip(out.world_position.xyz);

#ifdef VERTEX_UVS
  out.uv = vertex.uv;
#endif

#ifdef VERTEX_TANGENTS
  out.world_tangent = mesh_functions::mesh_tangent_local_to_world(
		model,
		vertex.tangent,
		vertex.instance_index
	);
#endif

#ifdef VERTEX_COLORS
  out.color = vertex.color;
#endif

#ifdef VERTEX_OUTPUT_INSTANCE_INDEX
	out.instance_index = vertex.instance_index;
#endif

  return out;
}
