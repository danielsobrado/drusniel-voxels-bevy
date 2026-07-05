fn dow_hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn dow_noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dow_hash21(i), dow_hash21(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(dow_hash21(i + vec2<f32>(0.0, 1.0)), dow_hash21(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y,
  );
}

fn dow_fbm3(p: vec2<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 3; i = i + 1) {
    v = v + dow_noise2(q) * a;
    q = q * 1.73 + vec2<f32>(17.0, 9.0);
    a = a * 0.5;
  }
  return v;
}

fn ocean_wave(
  world_xz: vec2<f32>,
  direction: vec2<f32>,
  wavelength: f32,
  amplitude: f32,
  speed: f32,
  time_seconds: f32,
  choppiness: f32,
) -> vec4<f32> {
  let k = 6.28318530718 / max(wavelength, 0.001);
  let phase = dot(world_xz, direction) * k + time_seconds * speed;
  let s = sin(phase);
  let c = cos(phase);
  let sharpness = 1.0 + max(choppiness, 0.0) * 0.72;
  let crest = pow(max((s + 1.0) * 0.5, 0.0001), sharpness);
  let height = amplitude * (crest * 2.0 - 1.0);
  let slope_scale = amplitude * sharpness * pow(max((s + 1.0) * 0.5, 0.0001), sharpness - 1.0) * c * k;
  return vec4<f32>(height, direction.x * slope_scale, direction.y * slope_scale, abs(c * amplitude * k * max(choppiness, 0.0)));
}

fn deep_ocean_wave_sample(
  world_xz: vec2<f32>,
  time_seconds: f32,
  wind_direction: vec2<f32>,
  wave_params: vec4<f32>,
  patch_params: vec4<f32>,
  transition_primary: vec4<f32>,
  transition_secondary: vec4<f32>,
  coast_behavior: vec4<f32>,
) -> vec4<f32> {
  let wind_speed = wave_params.x;
  let height_scale = wave_params.y;
  let choppiness = wave_params.z;
  let level_id = wave_params.w;
  let coarse_patch = patch_params.x;
  let fine_patch = patch_params.y;
  let coast_distance = transition_primary.x;
  let sandy = transition_primary.y;
  let rocky = transition_primary.z;
  let cliff = transition_primary.w;
  let cove = transition_secondary.x;
  let reef = transition_secondary.y;
  let coast_noise = transition_secondary.z;
  let near_shore = transition_secondary.w;
  let wind = normalize(wind_direction);
  let cross_wind = vec2<f32>(-wind.y, wind.x);
  let speed = sqrt(max(wind_speed, 0.01)) * 0.42;
  let shore_target = coast_behavior.w / max(height_scale, 0.001);
  let shore_mix = clamp(near_shore * (sandy + cove * 0.8), 0.0, 1.0);
  let local_height = height_scale
    * mix(1.0, 0.56, sandy * near_shore)
    * mix(1.0, 0.42, cove * near_shore)
    * (1.0 + cove * (1.0 - near_shore) * 0.2 + reef * 0.08)
    * mix(1.0, shore_target, shore_mix);
  let local_choppiness = choppiness
    * (1.0 + rocky * near_shore * 0.58 + cliff * near_shore * 0.24)
    * mix(1.0, 0.72, cove * near_shore);

  let swell_a = ocean_wave(world_xz, wind, coarse_patch, local_height * 0.58, speed, time_seconds, local_choppiness * 0.32);
  let swell_b = ocean_wave(world_xz, normalize(wind * 0.78 + cross_wind * 0.22), coarse_patch * 0.57, local_height * 0.31, speed * 1.17, time_seconds, local_choppiness * 0.42);
  let chop_a = ocean_wave(world_xz, normalize(wind * 0.61 - cross_wind * 0.39), fine_patch, local_height * 0.12, speed * 2.35, time_seconds, local_choppiness);
  let chop_b = ocean_wave(world_xz, normalize(wind * 0.36 + cross_wind * 0.64), fine_patch * 0.53, local_height * 0.07, speed * 3.1, time_seconds, local_choppiness * 0.78);
  let fine_weight = select(select(0.0, 0.55, level_id < 1.5), 1.0, level_id < 0.5);
  let combined = swell_a + swell_b + (chop_a + chop_b) * fine_weight;
  let slope = length(combined.yz);
  var foam = pow(smoothstep(patch_params.z, 1.0, slope), max(patch_params.w, 0.001));
  let reef_center = -coast_behavior.z * 0.45;
  let reef_line = (1.0 - smoothstep(coast_behavior.z * 0.1, coast_behavior.z * 0.32, abs(coast_distance - reef_center))) * reef;
  let cliff_base = (1.0 - smoothstep(0.0, coast_behavior.y, abs(coast_distance))) * cliff;
  let cliff_spray = cliff_base * smoothstep(0.62, 0.86, coast_noise);
  let foam_breakup = 0.55 + 0.45 * smoothstep(0.25, 0.85, dow_fbm3(world_xz * 0.05 + vec2<f32>(time_seconds * 0.03, 0.0)));
  foam = clamp((foam + reef_line * 0.92 + cliff_base * 0.42 + cliff_spray * 0.58) * foam_breakup, 0.0, 1.0);
  return vec4<f32>(combined.x, combined.y, combined.z, foam);
}

fn deep_ocean_outside_distance(world_xz: vec2<f32>, bounds: vec4<f32>) -> f32 {
  let dx = max(max(bounds.x - world_xz.x, 0.0), world_xz.x - bounds.y);
  let dz = max(max(bounds.z - world_xz.y, 0.0), world_xz.y - bounds.w);
  return length(vec2<f32>(dx, dz));
}

fn deep_ocean_shade(
  world_position: vec3<f32>,
  normal_value: vec3<f32>,
  camera_position: vec3<f32>,
  sun_direction: vec3<f32>,
  bounds: vec4<f32>,
  start_outside_m: f32,
  level_fade: vec4<f32>,
  deep_color: vec3<f32>,
  shallow_color: vec3<f32>,
  foam_color: vec3<f32>,
  fog_color: vec3<f32>,
  shading_params: vec4<f32>,
  fog_params: vec4<f32>,
  foam_value: f32,
  sky_zenith: vec3<f32>,
  sss_color: vec3<f32>,
  detail_params: vec4<f32>,
  horizon_blend: vec2<f32>,
  transition_primary: vec4<f32>,
  transition_secondary: vec4<f32>,
) -> vec4<f32> {
  let outside_distance = deep_ocean_outside_distance(world_position.xz, bounds);
  let border_alpha = smoothstep(start_outside_m, start_outside_m + 48.0, outside_distance);
  let camera_distance = distance(world_position.xz, camera_position.xz);
  let level_alpha = smoothstep(level_fade.x, level_fade.y, camera_distance) * (1.0 - smoothstep(level_fade.z, level_fade.w, camera_distance));
  let sandy = transition_primary.y;
  let rocky = transition_primary.z;
  let cliff = transition_primary.w;
  let cove = transition_secondary.x;
  let reef = transition_secondary.y;
  let coast_noise = transition_secondary.z;
  let near_shore = transition_secondary.w;

  let detail_fade = 1.0 - smoothstep(detail_params.y, detail_params.z, camera_distance);
  let uv = world_position.xz * 0.14;
  let h = dow_fbm3(uv);
  let detail = vec2<f32>(dow_fbm3(uv + vec2<f32>(0.35, 0.0)) - h, dow_fbm3(uv + vec2<f32>(0.0, 0.35)) - h) * detail_fade * detail_params.x;
  let normal = normalize(vec3<f32>(normal_value.x - detail.x, normal_value.y, normal_value.z - detail.y));
  let view_direction = normalize(camera_position - world_position);
  let sun = normalize(sun_direction);
  let fresnel = pow(1.0 - max(dot(view_direction, normal), 0.0), max(shading_params.x, 0.001)) * shading_params.y;
  let shallow_mix = clamp(0.18 + normal.y * 0.12 + sandy * near_shore * 0.38 + reef * near_shore * (0.24 + coast_noise * 0.18) - cliff * near_shore * 0.18 - rocky * near_shore * 0.08, 0.0, 1.0);
  var color = mix(deep_color, shallow_color, shallow_mix);
  color *= 1.0 - cliff * near_shore * 0.22;
  color *= 1.0 - rocky * near_shore * (0.08 + coast_noise * 0.08);
  color *= 1.0 - cove * near_shore * 0.04;
  let reflected_sky = mix(fog_color, sky_zenith, smoothstep(0.0, 0.65, max(reflect(-view_direction, normal).y, 0.0)));
  color = mix(color, reflected_sky, clamp(fresnel * shading_params.z, 0.0, 1.0));

  let half_direction = normalize(sun + view_direction);
  let roughness = max(fog_params.w, 0.01);
  let sun_specular = pow(max(dot(normal, half_direction), 0.0), mix(180.0, 18.0, roughness));
  color += vec3<f32>(sun_specular * (0.35 + shading_params.z * 0.65));
  color += sss_color * detail_params.w * pow(max(dot(view_direction, -sun), 0.0), 4.0) * (0.25 + foam_value * 0.5);
  let cliff_spray_glow = cliff * near_shore * smoothstep(0.62, 0.88, coast_noise) * 0.35;
  color = mix(color, foam_color, clamp(foam_value + cliff_spray_glow, 0.0, 1.0));

  let fog_t = clamp((camera_distance - fog_params.x) / max(fog_params.y - fog_params.x, 1.0), 0.0, 1.0);
  var fog_amount = 1.0 - exp(-max(fog_params.z, 0.0) * fog_t * fog_t * 3.0);
  fog_amount = max(fog_amount, smoothstep(horizon_blend.x, horizon_blend.y, camera_distance));
  color = mix(color, fog_color, clamp(fog_amount, 0.0, 1.0));
  return vec4<f32>(color, border_alpha * level_alpha);
}
