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
  let material_amplitude = water_bindings::material.amplitude;
  let debug_disable_voxel_ripple_lines = water_bindings::material.edge_scale < 0.0;
  let ripple_overlay_strength = select(
    clamp(water_bindings::material.edge_color.a, 0.0, 2.0),
    0.0,
    debug_disable_voxel_ripple_lines
  );
  let voxel_water_surface = water_bindings::material.coord_scale.x < 8.0;
  let pond_profile = voxel_water_surface && material_amplitude <= 0.08;
  let lake_profile = voxel_water_surface && material_amplitude > 0.08 && material_amplitude <= 0.36;
  let river_profile = voxel_water_surface && material_amplitude > 0.36 && material_amplitude <= 0.5;
  let calm_inland_profile = pond_profile || lake_profile;
  var body_wave_speed = 1.3;
  var body_wave_scale = 0.85;
  var body_wave_count = 4u;
  var body_detail_scroll_speed = 0.04;
  var body_detail_intensity = 0.8;
  var body_crest_foam = 1.0;
  var body_shore_foam = 1.0;
  if (lake_profile) {
    body_wave_speed = 0.5;
    body_wave_scale = 1.1;
    body_wave_count = 2u;
    body_detail_scroll_speed = 0.02;
    body_detail_intensity = 1.35;
    body_crest_foam = 0.0;
    body_shore_foam = 0.3;
  }
  if (pond_profile) {
    body_wave_speed = 0.3;
    body_wave_scale = 3.0;
    body_wave_count = 1u;
    body_detail_scroll_speed = 0.012;
    body_detail_intensity = 0.55;
    body_crest_foam = 0.0;
    body_shore_foam = 0.08;
  }
  if (river_profile) {
    body_wave_speed = 0.65;
    body_wave_scale = 1.6;
    body_wave_count = 2u;
    body_detail_scroll_speed = 0.026;
    body_detail_intensity = 0.45;
    body_crest_foam = 0.0;
    body_shore_foam = 0.35;
  }

  // Wave height for vertex displacement (driven by bevy_water functions)
  let height = water_fn::get_wave_height(w_pos);

  // Compute normals and foam using Gerstner waves (analytical, much better than finite differences)
  var foam_from_waves = 0.0;
#ifdef DYN_WATER
  let gerstner = gerstner_waves::sum_gerstner_waves_limited(
    w_pos, globals.time * body_wave_speed, material_amplitude, body_wave_scale, body_wave_count
  );
  in.world_normal = gerstner.normal;
  foam_from_waves = gerstner.foam * body_crest_foam;

  // Blend in detail normal maps for fine-scale ripple texture
#ifdef WATER_DETAIL_NORMALS
  let cam_dist = length(view.world_position.xyz - world_position.xyz);
  in.world_normal = water_detail_normals::blend_detail_normals(
    in.world_normal, world_position.xyz, globals.time,
    0.3, 0.17, body_detail_scroll_speed, body_detail_intensity, cam_dist
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
  let edge_scale = abs(water_bindings::material.edge_scale);
  let edge_color_binding = water_bindings::material.edge_color;
  let edge_color = vec4<f32>(edge_color_binding.rgb, shallow_color.a);

  let z_depth_buffer_ndc = bevy_pbr::prepass_utils::prepass_depth(in.position, 0u);
  let z_depth_buffer_view = depth_ndc_to_view_z(z_depth_buffer_ndc);
  let z_fragment_view = depth_ndc_to_view_z(in.position.z);
  let raw_depth_diff = z_fragment_view - z_depth_buffer_view;
  // For voxel water, enforce minimum depth to prevent striping in shallow areas
  let min_depth = select(0.0, 0.3, voxel_water_surface);
  depth_diff_view = max(raw_depth_diff, min_depth);
  let beers_law = clamp(exp(-depth_diff_view * water_clarity), 0.0, 1.0);
  let depth_color = vec4<f32>(mix(deep_color.xyz, shallow_color.xyz, beers_law), 1.0 - beers_law);
  water_color = mix(edge_color, depth_color, smoothstep(0.0, edge_scale, depth_diff_view));

  // Foam: combine depth-based shore foam with Gerstner wave crest foam
  let shore_foam_amount = (1.0 - smoothstep(FOAM_EDGE_START, FOAM_EDGE_END, depth_diff_view)) * body_shore_foam;
  let total_foam_amount = max(shore_foam_amount, foam_from_waves);
  var foam_params: water_foam::FoamParams;
  foam_params.color = vec3<f32>(0.9, 0.95, 1.0);
  foam_params.intensity = select(1.3, 0.45, calm_inland_profile);
  foam_params.intensity = select(foam_params.intensity, 0.15, pond_profile);
  foam_params.scale = 1.2;
  foam_params.persistence = 0.9;
  foam_params.edge_sharpness = 0.3;
  let foam = water_foam::calculate_foam_texture(w_pos, globals.time, total_foam_amount, foam_params);
  water_color = vec4<f32>(mix(water_color.rgb, foam.rgb, foam.a), water_color.a);
#endif
#endif
#endif
  // Voxel water uses body presets for inland/ocean visual differences.
  if (voxel_water_surface) {
    let shallow_bias = select(0.3, 0.08, calm_inland_profile);
    water_color = vec4<f32>(mix(water_color.rgb, shallow_color.rgb, shallow_bias), water_color.a);
    if (!debug_disable_voxel_ripple_lines) {
      let ripple_a = sin(dot(world_position.xz, vec2<f32>(1.25, 0.38)) + globals.time * body_wave_speed * 1.8);
      let ripple_b = sin(dot(world_position.xz, vec2<f32>(-0.54, 1.05)) + globals.time * body_wave_speed * 1.25);
      let ripple = ripple_a * 0.5 + ripple_b * 0.5;
      let ripple_line = smoothstep(0.12, 0.72, abs(ripple));
      let ripple_contrast = select(0.35, 1.1, lake_profile);
      var ripple_contrast_body = select(ripple_contrast, 0.28, river_profile);
      ripple_contrast_body = select(ripple_contrast_body, 0.72, pond_profile);
      let ripple_strength = ripple_contrast_body * ripple_overlay_strength;
      let ripple_highlight = vec3<f32>(0.3, 0.37, 0.38) * ripple_line * ripple_strength;
      let ripple_shadow = 1.0 - (1.0 - ripple_line) * ripple_strength * 0.82;
      water_color = vec4<f32>(
        water_color.rgb * (1.0 + ripple * ripple_strength) * ripple_shadow + ripple_highlight,
        water_color.a
      );
    }
    let configured_alpha = max(pbr_input.material.base_color.a, max(shallow_color.a, deep_color.a) * 0.72);
    let base_alpha = clamp(configured_alpha, 0.45, 0.98);
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
    var fresnel_power_body = 5.6;
    if (lake_profile) {
      fresnel_power_body = 4.4;
    }
    if (pond_profile || river_profile) {
      fresnel_power_body = 4.0;
    }
    let fresnel = pow(1.0 - NdotV, fresnel_power_body);

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
    var reflectivity = 0.88;
    if (lake_profile) {
      reflectivity = 0.84;
    }
    if (pond_profile) {
      reflectivity = 0.62;
    }
    if (river_profile) {
      reflectivity = 0.58;
    }
    let reflection_floor = select(0.02, 0.32, lake_profile);
    let reflection_floor_body = select(reflection_floor, 0.08, pond_profile || river_profile);
    let reflection_strength = max(fresnel * reflectivity, reflection_floor_body);
    out.color = vec4<f32>(
      mix(out.color.rgb, reflection_color, reflection_strength),
      // At glancing angles water becomes more opaque (reflecting surface, not transparent)
      mix(out.color.a, 1.0, reflection_strength * 0.6)
    );
    if (voxel_water_surface && !debug_disable_voxel_ripple_lines) {
      let lake_ripple_a = sin(dot(world_position.xz, vec2<f32>(1.25, 0.38)) + globals.time * body_wave_speed * 1.8);
      let lake_ripple_b = sin(dot(world_position.xz, vec2<f32>(-0.54, 1.05)) + globals.time * body_wave_speed * 1.25);
      let lake_ripple_fine = sin(dot(world_position.xz, vec2<f32>(2.1, -0.72)) + globals.time * body_wave_speed * 2.3);
      let lake_ripple = lake_ripple_a * 0.42 + lake_ripple_b * 0.38 + lake_ripple_fine * 0.2;
      let lake_line = pow(smoothstep(0.1, 0.72, abs(lake_ripple)), 1.15);
      var voxel_ripple_strength = 0.45;
      voxel_ripple_strength = select(voxel_ripple_strength, 0.72, pond_profile);
      voxel_ripple_strength = select(voxel_ripple_strength, 1.0, lake_profile);
      let lake_overlay_strength = voxel_ripple_strength * ripple_overlay_strength;
      let lake_trough = 1.0 - (1.0 - lake_line) * 0.42 * lake_overlay_strength;
      let lake_glint = vec3<f32>(0.26, 0.34, 0.36) * lake_line * lake_overlay_strength;
      out.color = vec4<f32>(out.color.rgb * lake_trough + lake_glint, out.color.a);
    }
  }

  // apply in-shader post processing (fog, alpha-premultiply, and also tonemapping, debanding if the camera is non-hdr)
  // note this does not include fullscreen postprocessing effects like bloom.
  out.color = main_pass_post_lighting_processing(pbr_input, out.color);
#endif

  return out;
}
