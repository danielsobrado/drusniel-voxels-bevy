fn surf_hash(value_in: u32) -> f32 {
  var value = value_in;
  value = value ^ (value >> 16u);
  value = value * 2146121005u;
  value = value ^ (value >> 15u);
  value = value * 2221713035u;
  value = value ^ (value >> 16u);
  return f32(value) / 4294967296.0;
}

fn surf_hash2(cell: vec2<i32>, seed: u32) -> f32 {
  return surf_hash(
    seed
      ^ bitcast<u32>(cell.x * 521288629)
      ^ bitcast<u32>(cell.y * 1597334677),
  );
}

fn surf_noise2(p: vec2<f32>, seed: u32) -> f32 {
  let cell = vec2<i32>(floor(p));
  let fraction = fract(p);
  let blend = fraction * fraction * (vec2<f32>(3.0) - 2.0 * fraction);
  let a = surf_hash2(cell, seed);
  let b = surf_hash2(cell + vec2<i32>(1, 0), seed);
  let c = surf_hash2(cell + vec2<i32>(0, 1), seed);
  let d = surf_hash2(cell + vec2<i32>(1, 1), seed);
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

fn surf_centered_band(distance_m: f32, width_m: f32) -> f32 {
  return 1.0 - smoothstep(width_m * 0.35, width_m, abs(distance_m));
}

fn surf_band_style(
  world_xz: vec2<f32>,
  transition_primary: vec4<f32>,
  transition_secondary: vec4<f32>,
  surf_widths: vec3<f32>,
  surf_params: vec4<f32>,
  seed_value: u32,
) -> vec4<f32> {
  let distance = transition_primary.x;
  let sandy_weight = transition_primary.y;
  let rocky_weight = transition_primary.z;
  let cliff_weight = transition_primary.w;
  let cove_weight = transition_secondary.x;
  let reef_weight = transition_secondary.y;
  let animated = vec2<f32>(
    world_xz.x * surf_params.x + surf_params.w * surf_params.y,
    world_xz.y * surf_params.x - surf_params.w * surf_params.y * surf_params.z,
  );
  let noise = surf_noise2(animated, seed_value ^ 1374496523u);

  let sandy = surf_centered_band(distance, surf_widths.x)
    * (0.72 + noise * 0.28);
  let rocky_width = (surf_widths.x + surf_widths.y) * 0.5;
  let rocky = surf_centered_band(distance, rocky_width)
    * smoothstep(0.48, 0.76, noise);
  let cliff_noise = surf_noise2(
    world_xz * surf_params.x * 1.9 + vec2<f32>(0.0, surf_params.w * surf_params.y * 2.3),
    seed_value ^ 2738958700u,
  );
  let cliff_base = surf_centered_band(distance, surf_widths.y);
  let cliff_spray = cliff_base * smoothstep(0.58, 0.82, cliff_noise);
  let cliff = min(1.0, cliff_base * 0.92 + cliff_spray * 0.55);
  let cove = surf_centered_band(distance, surf_widths.x * 0.72)
    * (0.24 + noise * 0.18);
  let reef_center = -surf_widths.z * 0.45;
  let reef_distance = abs(distance - reef_center);
  let reef = (1.0 - smoothstep(
    surf_widths.z * 0.1,
    surf_widths.z * 0.32,
    reef_distance,
  )) * (0.68 + noise * 0.32);

  let alpha = clamp(
    sandy * sandy_weight
      + rocky * rocky_weight
      + cliff * cliff_weight
      + cove * cove_weight
      + reef * reef_weight,
    0.0,
    1.0,
  );
  let rocky_tint = rocky_weight * (1.0 - noise) * 0.28;
  let cove_softness = cove_weight * 0.18;
  let tint = vec3<f32>(
    1.0 - rocky_tint,
    1.0 - rocky_tint * 0.8,
    1.0 - rocky_tint * 0.55,
  ) * (1.0 - cove_softness);
  return vec4<f32>(tint, alpha);
}
