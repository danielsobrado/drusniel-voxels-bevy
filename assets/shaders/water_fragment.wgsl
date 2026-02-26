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
#import gerstner_waves
#import water_foam
#ifdef WATER_DETAIL_NORMALS
#import water_detail_normals
#endif

// Shore foam edge detection thresholds
const FOAM_EDGE_START: f32 = 0.0;   // Start foam at water edge
const FOAM_EDGE_END: f32 = 2.0;     // Foam fades out at this depth

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

  // Wave height for vertex displacement (driven by bevy_water functions)
  let height = water_fn::get_wave_height(w_pos);

  // Compute normals and foam using Gerstner waves (analytical, much better than finite differences)
  var foam_from_waves = 0.0;
#ifdef DYN_WATER
  let gerstner = gerstner_waves::sum_gerstner_waves(
    w_pos, globals.time, water_bindings::material.amplitude, 1.0
  );
  in.world_normal = gerstner.normal;
  foam_from_waves = gerstner.foam;

  // Blend in detail normal maps for fine-scale ripple texture
#ifdef WATER_DETAIL_NORMALS
  let cam_dist = length(view.world_position.xyz - world_position.xyz);
  in.world_normal = water_detail_normals::blend_detail_normals(
    in.world_normal, world_position.xyz, globals.time,
    0.3, 0.17, 0.04, 0.8, cam_dist
  );
#endif
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
  var depth_diff_view = 0.0;
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
  depth_diff_view = max(raw_depth_diff, min_depth);
  let beers_law = clamp(exp(-depth_diff_view * water_clarity), 0.0, 1.0);
  let depth_color = vec4<f32>(mix(deep_color.xyz, shallow_color.xyz, beers_law), 1.0 - beers_law);
  water_color = mix(edge_color, depth_color, smoothstep(0.0, edge_scale, depth_diff_view));

  // Foam: combine depth-based shore foam with Gerstner wave crest foam
  let shore_foam_amount = 1.0 - smoothstep(FOAM_EDGE_START, FOAM_EDGE_END, depth_diff_view);
  let total_foam_amount = max(shore_foam_amount, foam_from_waves);
  var foam_params: water_foam::FoamParams;
  foam_params.color = vec3<f32>(0.9, 0.95, 1.0);
  foam_params.intensity = 1.3;
  foam_params.scale = 1.2;
  foam_params.persistence = 0.9;
  foam_params.edge_sharpness = 0.3;
  let foam = water_foam::calculate_foam_texture(w_pos, globals.time, total_foam_amount, foam_params);
  water_color = vec4<f32>(mix(water_color.rgb, foam.rgb, foam.a), water_color.a);
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

  // Fresnel-based reflection blending (Valheim-style planar reflection approximation)
  // At glancing angles: strong sky/environment reflections (water looks like a mirror)
  // At steep angles: see through water to the depths below
  // NOTE: Uses reflected-direction sky gradient. Will be replaced with actual
  // planar reflection texture sampling when custom water material bindings are ready
  // (WaterReflectionTexture is already rendering via water_reflection.rs).
  {
    let view_dir = normalize(view.world_position.xyz - world_position.xyz);
    let water_normal = normalize(in.world_normal);
    let NdotV = max(dot(water_normal, view_dir), 0.0);

    // Schlick Fresnel — power 5.0 is physically plausible for water (IOR ~1.33)
    let fresnel = pow(1.0 - NdotV, 5.0);

    // Compute reflected direction for sky color lookup
    let reflected_dir = reflect(-view_dir, water_normal);

    // Sky gradient: horizon is warm/bright, zenith is cool/deep
    let sky_up = clamp(reflected_dir.y, 0.0, 1.0);
    let horizon_color = vec3<f32>(0.55, 0.65, 0.80);
    let zenith_color = vec3<f32>(0.25, 0.45, 0.85);

    // Approximate sun specular highlight in reflection
    let sun_dir = normalize(vec3<f32>(-0.3, 0.7, -0.2));
    let sun_contrib = max(dot(reflected_dir, sun_dir), 0.0);
    let sun_highlight = pow(sun_contrib, 64.0) * vec3<f32>(1.0, 0.92, 0.75) * 0.6;

    let reflection_color = mix(horizon_color, zenith_color, sky_up) + sun_highlight;

    // Blend reflection into lit water color
    let reflectivity = 0.88;
    let reflection_strength = fresnel * reflectivity;
    out.color = vec4<f32>(
      mix(out.color.rgb, reflection_color, reflection_strength),
      // At glancing angles water becomes more opaque (reflecting surface, not transparent)
      mix(out.color.a, 1.0, reflection_strength * 0.6)
    );
  }

  // apply in-shader post processing (fog, alpha-premultiply, and also tonemapping, debanding if the camera is non-hdr)
  // note this does not include fullscreen postprocessing effects like bloom.
  out.color = main_pass_post_lighting_processing(pbr_input, out.color);
#endif

  return out;
}
