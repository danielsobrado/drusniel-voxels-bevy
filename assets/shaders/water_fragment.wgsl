#import bevy_pbr::{
  pbr_functions::alpha_discard,
  pbr_fragment::pbr_input_from_standard_material,
  view_transformations::depth_ndc_to_view_z,
}

#ifdef PREPASS_PIPELINE
#import bevy_pbr::{
  prepass_io::{VertexOutput, FragmentOutput},
  pbr_deferred_functions::deferred_output,
}
#else
#import bevy_pbr::{
  forward_io::{VertexOutput, FragmentOutput},
  pbr_functions,
  pbr_functions::{apply_pbr_lighting, main_pass_post_lighting_processing},
  pbr_types::STANDARD_MATERIAL_FLAGS_UNLIT_BIT,
}
#endif

#ifdef MESHLET_MESH_MATERIAL_PASS
#import bevy_pbr::meshlet_visibility_buffer_resolve::resolve_vertex_output
#endif

#import bevy_water::water_bindings
#import bevy_water::water_functions as water_fn

// Shore foam constants
const FOAM_COLOR: vec3<f32> = vec3<f32>(0.9, 0.95, 1.0);   // White with slight blue tint
const FOAM_EDGE_START: f32 = 0.0;   // Start foam at water edge
const FOAM_EDGE_END: f32 = 2.0;     // Foam fades out at this depth
const FOAM_STRENGTH: f32 = 0.8;     // Maximum foam intensity

@fragment
fn fragment(
#ifdef MESHLET_MESH_MATERIAL_PASS
    @builtin(position) frag_coord: vec4<f32>,
#else
  p_in: VertexOutput,
  @builtin(front_facing) is_front: bool,
#endif
) -> FragmentOutput {
#ifdef MESHLET_MESH_MATERIAL_PASS
  let p_in = resolve_vertex_output(frag_coord);
  let is_front = true;
#endif

  var in = p_in;
  var world_position: vec4<f32> = in.world_position;
  let w_pos = water_fn::uv_to_coord(in.uv);
  // Calculate normal.
  let height = water_fn::get_wave_height(w_pos);
#ifdef DYN_WATER
  let delta = 0.5;
  let height_dx = water_fn::get_wave_height(w_pos + vec2<f32>(delta, 0.0));
  let height_dz = water_fn::get_wave_height(w_pos + vec2<f32>(0.0, delta));
  in.world_normal = normalize(vec3<f32>(height - height_dx, delta, height - height_dz));
#else
  let pos = world_position.xyz + (in.world_normal * height);
  let pos_dx = dpdx(pos);
  let pos_dy = dpdy(pos);
  in.world_normal = normalize(cross(pos_dy, pos_dx));
#endif
 
  // If we're in the crossfade section of a visibility range, conditionally
  // discard the fragment according to the visibility pattern.
#ifdef VISIBILITY_RANGE_DITHER
  pbr_functions::visibility_range_dither(in.position, in.visibility_range_dither);
#endif

  // generate a PbrInput struct from the StandardMaterial bindings
  var pbr_input = pbr_input_from_standard_material(in, is_front);

  let deep_color = water_bindings::material.deep_color;
  let shallow_color = water_bindings::material.shallow_color;
  var water_color = deep_color;
#ifdef DEPTH_PREPASS
#ifndef PREPASS_PIPELINE
#ifndef WEBGL2
  let water_clarity = water_bindings::material.clarity;
  let edge_scale = water_bindings::material.edge_scale;
  let edge_color = water_bindings::material.edge_color;

  let z_depth_buffer_ndc = bevy_pbr::prepass_utils::prepass_depth(in.position, 0u);
  let z_depth_buffer_view = depth_ndc_to_view_z(z_depth_buffer_ndc);
  let z_fragment_view = depth_ndc_to_view_z(in.position.z);
  let raw_depth_diff = z_fragment_view - z_depth_buffer_view;
  // Detect voxel water early for depth adjustment
  let is_voxel_water = water_bindings::material.coord_scale.x < 8.0;
  // For voxel water, enforce minimum depth to prevent striping in shallow areas
  let min_depth = select(0.0, 0.3, is_voxel_water);
  let depth_diff_view = max(raw_depth_diff, min_depth);
  let beers_law = clamp(exp(-depth_diff_view * water_clarity), 0.0, 1.0);
  let depth_color = vec4<f32>(mix(deep_color.xyz, shallow_color.xyz, beers_law), 1.0 - beers_law);
  water_color = mix(edge_color, depth_color, smoothstep(0.0, edge_scale, depth_diff_view));

  // Shore foam effect: add foam at shallow water edges
  let foam_factor = (1.0 - smoothstep(FOAM_EDGE_START, FOAM_EDGE_END, depth_diff_view)) * FOAM_STRENGTH;
  water_color = vec4<f32>(mix(water_color.rgb, FOAM_COLOR, foam_factor), water_color.a);
#endif
#endif
#endif
  // Voxel water uses a much smaller coord scale; keep it visibly blue up close.
  let voxel_water = water_bindings::material.coord_scale.x < 8.0;
  if (voxel_water) {
    // Light blend toward shallow_color - let wave lighting variations show through
    water_color = vec4<f32>(mix(water_color.rgb, shallow_color.rgb, 0.3), 1.0);
    // Higher minimum alpha ensures water is always visible even in shallow areas
    let base_alpha = max(pbr_input.material.base_color.a, 0.95);
    pbr_input.material.base_color = vec4<f32>(water_color.rgb, base_alpha);
  } else {
    pbr_input.material.base_color *= water_color;
  }

  //let foam_color = water_bindings::material.edge_color;
  //let foam = mix(foam_color, depth_color, smoothstep(0.0, edge_scale, depth_diff_view));

  // alpha discard
  pbr_input.material.base_color = alpha_discard(pbr_input.material, pbr_input.material.base_color);

#ifdef PREPASS_PIPELINE
  // write the gbuffer, lighting pass id, and optionally normal and motion_vector textures
  let out = deferred_output(in, pbr_input);
#else
  // in forward mode, we calculate the lit color immediately, and then apply some post-lighting effects here.
  // in deferred mode the lit color and these effects will be calculated in the deferred lighting shader
  var out: FragmentOutput;
  if (pbr_input.material.flags & STANDARD_MATERIAL_FLAGS_UNLIT_BIT) == 0u {
    out.color = apply_pbr_lighting(pbr_input);
  } else {
    out.color = pbr_input.material.base_color;
  }

  // apply in-shader post processing (fog, alpha-premultiply, and also tonemapping, debanding if the camera is non-hdr)
  // note this does not include fullscreen postprocessing effects like bloom.
  out.color = main_pass_post_lighting_processing(pbr_input, out.color);

  // show grid
  //let f_pos = step(fract((w_pos / 10.06274)), vec2<f32>(0.995));
  //let grid = step(f_pos.x + f_pos.y, 1.00);
  //out.color += vec4<f32>(grid, grid, grid, 0.00);
#endif

  return out;
}
