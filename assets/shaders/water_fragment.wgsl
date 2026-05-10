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

#import bevy_pbr::mesh_view_bindings::globals

#import bevy_water::water_bindings
#import bevy_water::water_functions as water_fn
#import witchcraft_water_finish
#import gerstner_waves
#import water_foam as voronoi_foam_mod

// Toggle bit magnitudes — must match `WaterShaderToggles` in `src/rendering/water.rs`.
// The witchcraft alpha encoding lives in 0..=200; toggles use disjoint higher bands.
const WATER_TOGGLE_VORONOI_FOAM: f32 = 20000.0;
const WATER_TOGGLE_GERSTNER: f32 = 10000.0;

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
  let raw_edge_alpha = water_bindings::material.edge_color.a;
  // Decode water shader toggles (Voronoi foam, Gerstner) before stripping into
  // the witchcraft_water_finish alpha encoding.
  let voronoi_foam_enabled = raw_edge_alpha >= WATER_TOGGLE_VORONOI_FOAM;
  let edge_after_foam = select(raw_edge_alpha, raw_edge_alpha - WATER_TOGGLE_VORONOI_FOAM, voronoi_foam_enabled);
  let gerstner_enabled = edge_after_foam >= WATER_TOGGLE_GERSTNER;
  let edge_for_witchcraft = select(edge_after_foam, edge_after_foam - WATER_TOGGLE_GERSTNER, gerstner_enabled);
  let witchcraft_reflect_b_200 = edge_for_witchcraft >= 100.0;
  let witchcraft_without_reflect = select(edge_for_witchcraft, edge_for_witchcraft - 100.0, witchcraft_reflect_b_200);
  let witchcraft_legacy = witchcraft_without_reflect >= 50.0;
  let witchcraft_local_code = select(
    witchcraft_without_reflect,
    witchcraft_without_reflect - 50.0,
    witchcraft_legacy
  );
  let witchcraft_finish_enabled = witchcraft_local_code >= 8.0;
  let witchcraft_finish_style = select(1u, 3u, witchcraft_local_code >= 30.0);
  let witchcraft_raw_debug = u32(floor(witchcraft_local_code)) % 10u;
  let witchcraft_finish_debug = select(
    0u,
    witchcraft_raw_debug,
    witchcraft_finish_enabled && witchcraft_raw_debug <= 3u
  );

  // Calculate normal.
  let height = water_fn::get_wave_height(w_pos);
  if (gerstner_enabled) {
    // Analytical Gerstner-derived normal — replaces the QUALITY>2 finite
    // difference path and the dpdx/dpdy fallback. `wave_count` reuses the
    // existing bevy_water `quality` (1..=4) so layer count tracks render quality.
    let g_amp = max(water_bindings::material.amplitude, 0.05);
    let g_scale = max(water_bindings::material.coord_scale.x, 0.001);
    // bevy_water's `quality` is a shader_def, not a uniform field — pin Gerstner
    // wave_count at the max (4) when this branch runs.
    let g_count = 4u;
    let g_result = gerstner_waves::sum_gerstner_waves_limited(
      w_pos,
      globals.time,
      g_amp,
      g_scale,
      g_count,
    );
    in.world_normal = g_result.normal;
  } else {
#if QUALITY > 2
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
  }

  // If we're in the crossfade section of a visibility range, conditionally
  // discard the fragment according to the visibility pattern.
#ifdef VISIBILITY_RANGE_DITHER
  pbr_functions::visibility_range_dither(in.position, in.visibility_range_dither);
#endif

  // generate a PbrInput struct from the StandardMaterial bindings
  var pbr_input = pbr_input_from_standard_material(in, is_front);

  let deep_color = water_bindings::material.deep_color;
  var water_color = deep_color;
  // Track shore proximity for the optional Voronoi foam mix below; default to
  // "no edge" when the depth-diff path doesn't run (e.g. prepass / WebGL2).
  var edge_t: f32 = 1.0;
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
  let depth_color = vec4<f32>(mix(deep_color.xyz, shallow_color.xyz, beers_law), 1.0 - beers_law);
  let edge_blend = smoothstep(0.0, edge_scale, depth_diff_view);
  edge_t = edge_blend;
  water_color = mix(edge_color, depth_color, edge_blend);
#endif
#endif
#endif

  if (voronoi_foam_enabled) {
    // Multi-scale Voronoi foam — boosted at shorelines and at wave crests
    // (Gerstner Jacobian when available, otherwise surface tilt).
    let foam_uv = w_pos * 0.18 + vec2<f32>(globals.time * 0.05, globals.time * 0.03);
    let foam_pattern = voronoi_foam_mod::foam_noise(foam_uv, 3);
    let shore_mask = 1.0 - clamp(edge_t, 0.0, 1.0);
    var crest_mask = clamp(1.0 - in.world_normal.y, 0.0, 1.0);
    if (gerstner_enabled) {
      let g_amp_for_foam = max(water_bindings::material.amplitude, 0.05);
      let g_scale_for_foam = max(water_bindings::material.coord_scale.x, 0.001);
      let g_count_for_foam = clamp(water_bindings::material.quality, 1u, 4u);
      let g_for_foam = gerstner_waves::sum_gerstner_waves_limited(
        w_pos,
        globals.time,
        g_amp_for_foam,
        g_scale_for_foam,
        g_count_for_foam,
      );
      crest_mask = max(crest_mask, g_for_foam.foam);
    }
    let foam_amount = clamp(max(shore_mask * 0.85, crest_mask * 0.6), 0.0, 1.0);
    let foam_strength = clamp(foam_pattern * foam_amount, 0.0, 1.0);
    let foam_tint = vec3<f32>(0.92, 0.96, 1.0);
    water_color = vec4<f32>(
      mix(water_color.rgb, foam_tint, foam_strength * 0.65),
      clamp(water_color.a + foam_strength * 0.25, 0.0, 1.0),
    );
  }

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
