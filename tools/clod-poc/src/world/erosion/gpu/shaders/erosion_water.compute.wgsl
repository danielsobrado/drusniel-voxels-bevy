@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (!in_grid(x, z) || !in_interior(x, z)) { return; }
  let index = cell_index(x, z);
  let width = params.grid.x;
  let outgoing = state_b[index].flux_left + state_b[index].flux_right + state_b[index].flux_up + state_b[index].flux_down;
  let incoming = state_b[index - 1u].flux_right + state_b[index + 1u].flux_left
    + state_b[index - width].flux_down + state_b[index + width].flux_up;
  let delta = (i32(incoming) - i32(outgoing)) / 16;
  let next_water_i = max(0, i32(state_a[index].water) + delta);
  let next_water = u32(next_water_i);
  state_a[index].water = next_water;
  if (next_water == 0u) {
    state_a[index].velocity_x = 0;
    state_a[index].velocity_z = 0;
    return;
  }
  let denominator = max(1, min(2147483647, next_water_i * 16));
  let flux_x = clamp(i32(state_b[index].flux_right) - i32(state_b[index].flux_left), -524287, 524287);
  let flux_z = clamp(i32(state_b[index].flux_down) - i32(state_b[index].flux_up), -524287, 524287);
  let velocity_x = (flux_x * VELOCITY_SCALE) / denominator;
  let velocity_z = (flux_z * VELOCITY_SCALE) / denominator;
  let max_velocity = i32(params.water.x);
  state_a[index].velocity_x = clamp(velocity_x, -max_velocity, max_velocity);
  state_a[index].velocity_z = clamp(velocity_z, -max_velocity, max_velocity);
}
