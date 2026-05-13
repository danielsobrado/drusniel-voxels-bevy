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
#import witchcraft_water_finish
#import noble_gerstner
#import noble_foam
#import noble_detail_normals
#import noble_parallax

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
  var noble_sample_pos = w_pos;

#ifdef USE_NOBLE_PARALLAX
  let parallax_view_dir = normalize(view.world_position.xyz - world_position.xyz);
  noble_sample_pos = noble_parallax::parallaxMappingWater(
    noble_sample_pos,
    normalize(vec3<f32>(parallax_view_dir.x, parallax_view_dir.z, max(abs(parallax_view_dir.y), 0.08))),
    i32(water_bindings::material.wave_dir_a.y)
  );
#endif

  let raw_edge_alpha = water_bindings::material.edge_color.a;
  let witchcraft_reflect_b_200 = raw_edge_alpha >= 100.0;
  let witchcraft_without_reflect = select(raw_edge_alpha, raw_edge_alpha - 100.0, witchcraft_reflect_b_200);
  let witchcraft_legacy = witchcraft_without_reflect >= 50.0;
  let witchcraft_local_code = select(witchcraft_without_reflect, witchcraft_without_reflect - 50.0, witchcraft_legacy);
  let witchcraft_finish_enabled = witchcraft_local_code >= 8.0;
  let witchcraft_finish_style = select(1u, 3u, witchcraft_local_code >= 30.0);
  let witchcraft_raw_debug = u32(floor(witchcraft_local_code)) % 10u;
  let witchcraft_finish_debug = select(0u, witchcraft_raw_debug, witchcraft_finish_enabled && witchcraft_raw_debug <= 3u);

#ifdef USE_NOBLE_GERSTNER
  in.world_normal = noble_gerstner::getWaterNormal(
    vec3<f32>(noble_sample_pos.x, world_position.y, noble_sample_pos.y),
    i32(water_bindings::material.wave_dir_a.y)
  );
#else
  let height = water_fn::get_wave_height(noble_sample_pos);
#if QUALITY > 2
  let delta = 0.5;
  let height_dx = water_fn::get_wave_height(noble_sample_pos + vec2<f32>(delta, 0.0));
  let height_dz = water_fn::get_wave_height(noble_sample_pos + vec2<f32>(0.0, delta));
  in.world_normal = normalize(vec3<f32>(height - height_dx, delta, height - height_dz));
#else
  let pos = world_position.xyz + (in.world_normal * height);
  let pos_dx = dpdx(pos);
  let pos_dy = dpdy(pos);
  in.world_normal = normalize(cross(pos_dy, pos_dx));
#endif
#endif

#ifdef USE_NOBLE_DETAIL_NORMALS
  in.world_normal = noble_detail_normals::blendDetailNormals(
    in.world_normal,
    vec3<f32>(noble_sample_pos.x, world_position.y, noble_sample_pos.y),
    depth_ndc_to_view_z(in.position.z)
  );
#endif

#ifdef VISIBILITY_RANGE_DITHER
  pbr_functions::visibility_range_dither(in.position, in.visibility_range_dither);
#endif

  var pbr_input = pbr_input_from_standard_material(in, is_front);

  let deep_color = water_bindings::material.deep_color;
  var water_color = deep_color;
#ifdef DEPTH_PREPASS
#ifndef PREPASS_PIPELINE
#ifndef WEBGL2
  let water_clarity = water_bindings::material.clarity;
  let shallow_color = water_bindings::material.shallow_color;
  let edge_scale = water_bindings::material.edge_scale;
  var edge_color = water_bindings::material.edge_color;
  if (witchcraft_finish_enabled) {
    edge_color.a = 1.0;
  }

  let z_depth_buffer_ndc = bevy_pbr::prepass_utils::prepass_depth(in.position, 0u);
  let z_depth_buffer_view = depth_ndc_to_view_z(z_depth_buffer_ndc);
  let z_fragment_view = depth_ndc_to_view_z(in.position.z);
  let depth_diff_view = z_fragment_view - z_depth_buffer_view;
  let beers_law = exp(-depth_diff_view * water_clarity);
  let depth_rgb = mix(deep_color.xyz, shallow_color.xyz, beers_law);
  let configured_surface_alpha = mix(deep_color.a, shallow_color.a, beers_law);
  // This alpha is multiplied by the base material alpha below, so compensate
  // here to keep shallow water visibly tinted across the full surface.
  let base_surface_alpha = max(pbr_input.material.base_color.a, 0.001);
  let surface_tint_alpha = clamp((configured_surface_alpha * 0.84) / base_surface_alpha, 0.0, 1.0);
  let depth_alpha = max(1.0 - beers_law, surface_tint_alpha);
  let depth_color = vec4<f32>(depth_rgb, depth_alpha);
  let edge_enabled = edge_scale >= 0.0;
  let edge_extent = max(abs(edge_scale), 0.001);
  let edge_blend = select(1.0, smoothstep(0.0, edge_extent, depth_diff_view), edge_enabled);
  let edge_factor = 1.0 - edge_blend;
  let foam_multiplier = vec3<f32>(0.78, 0.84, 0.88);
  water_color = vec4<f32>(
    mix(depth_color.rgb, foam_multiplier, edge_factor * 0.10),
    max(depth_color.a, edge_factor * clamp(edge_color.a, 0.0, 1.0) * 0.22)
  );

#ifdef USE_NOBLE_FOAM
  let noble_edge_extent = max(abs(edge_scale), 0.001);
  let noble_edge_foam = 1.0 - smoothstep(0.0, noble_edge_extent, depth_diff_view);
  let noble_crest_foam = saturate((1.0 - in.world_normal.y) * water_bindings::material.amplitude);
  let noble_foam_sample = noble_foam::calculateFoamTexture(noble_sample_pos, noble_edge_foam, noble_crest_foam);
  water_color.rgb = mix(water_color.rgb, noble_foam_sample.rgb, noble_foam_sample.a);
  water_color.a = max(water_color.a, noble_foam_sample.a * 0.35);
#endif
#endif
#endif
#endif
  pbr_input.material.base_color *= water_color;

  if (witchcraft_finish_enabled) {
    let finish_view_dir = normalize(view.world_position.xyz - world_position.xyz);
    let finish_water_normal = normalize(in.world_normal);
    let finish_ndot = max(dot(finish_water_normal, finish_view_dir), 0.0);
    let finish_fresnel = 1.0 - finish_ndot;
    var finish_params: witchcraft_water_finish::WitchcraftWaterFinishParams;
    finish_params.enabled = true;
    finish_params.style = witchcraft_finish_style;
    finish_params.watercolor_mode = 3u;
    finish_params.legacy = witchcraft_legacy;
    finish_params.color_multiplier_enabled = false;
    finish_params.color_multiplier = vec3<f32>(1.0);
    finish_params.reflect_b = select(160u, 200u, witchcraft_reflect_b_200);
    finish_params.debug = witchcraft_finish_debug;
    let finish = witchcraft_water_finish::apply_witchcraft_water_finish(
      finish_params,
      pbr_input.material.base_color,
      water_bindings::material.shallow_color.rgb,
      pbr_input.material.base_color.rgb,
      finish_fresnel,
      finish_ndot,
      true
    );
    pbr_input.material.base_color = finish.color;
  }

  pbr_input.material.base_color = alpha_discard(pbr_input.material, pbr_input.material.base_color);

#ifdef PREPASS_PIPELINE
  let out = deferred_output(in, pbr_input);
#else
  var out: FragmentOutput;
  if (pbr_input.material.flags & STANDARD_MATERIAL_FLAGS_UNLIT_BIT) == 0u {
    out.color = apply_pbr_lighting(pbr_input);
  } else {
    out.color = pbr_input.material.base_color;
  }
  out.color = main_pass_post_lighting_processing(pbr_input, out.color);
#endif

  return out;
}
