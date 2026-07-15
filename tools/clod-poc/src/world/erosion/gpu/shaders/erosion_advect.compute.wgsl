@compute @workgroup_size(8, 8)
fn clear_scratch(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!in_grid(gid.x, gid.y)) { return; }
  atomicStore(&sediment_scratch[cell_index(gid.x, gid.y)], 0u);
}

@compute @workgroup_size(8, 8)
fn scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (!in_grid(x, z) || !in_interior(x, z)) { return; }
  let index = cell_index(x, z);
  let suspended = state_a[index].sediment;
  if (suspended == 0u) { return; }
  let border = i32(params.grid.z);
  let end_x = i32(params.grid.x - params.grid.z);
  let end_z = i32(params.grid.y - params.grid.z);
  let min_x_fixed = border * VELOCITY_SCALE;
  let max_x_fixed = (end_x - 1) * VELOCITY_SCALE;
  let min_z_fixed = border * VELOCITY_SCALE;
  let max_z_fixed = (end_z - 1) * VELOCITY_SCALE;
  let target_x_fixed = clamp(i32(x) * VELOCITY_SCALE + state_a[index].velocity_x, min_x_fixed, max_x_fixed);
  let target_z_fixed = clamp(i32(z) * VELOCITY_SCALE + state_a[index].velocity_z, min_z_fixed, max_z_fixed);
  let x0 = target_x_fixed / VELOCITY_SCALE;
  let z0 = target_z_fixed / VELOCITY_SCALE;
  let x1 = min(end_x - 1, x0 + 1);
  let z1 = min(end_z - 1, z0 + 1);
  let fx = u32(target_x_fixed - x0 * VELOCITY_SCALE);
  let fz = u32(target_z_fixed - z0 * VELOCITY_SCALE);
  let p00 = mul_q16(suspended, bilinear_weight_q16(fx, fz, 0u, 0u));
  let p10 = mul_q16(suspended, bilinear_weight_q16(fx, fz, 1u, 0u));
  let p01 = mul_q16(suspended, bilinear_weight_q16(fx, fz, 0u, 1u));
  let p11 = suspended - p00 - p10 - p01;
  let width = i32(params.grid.x);
  atomicAdd(&sediment_scratch[u32(z0 * width + x0)], p00);
  atomicAdd(&sediment_scratch[u32(z0 * width + x1)], p10);
  atomicAdd(&sediment_scratch[u32(z1 * width + x0)], p01);
  atomicAdd(&sediment_scratch[u32(z1 * width + x1)], p11);
}
