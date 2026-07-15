fn head(index: u32) -> i32 {
  return state_a[index].height * 16 + i32(min(state_a[index].water, 2147483647u));
}

fn update_flux(previous: u32, difference: i32) -> u32 {
  let change = mul_q16(u32(abs(difference)), params.rain.z);
  if (difference >= 0) { return add_sat_u32(previous, change); }
  return select(0u, previous - change, previous >= change);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (!in_grid(x, z) || !in_interior(x, z)) { return; }
  let index = cell_index(x, z);
  let width = params.grid.x;
  let center = head(index);
  var left = update_flux(state_b[index].flux_left, center - head(index - 1u));
  var right = update_flux(state_b[index].flux_right, center - head(index + 1u));
  var up = update_flux(state_b[index].flux_up, center - head(index - width));
  var down = update_flux(state_b[index].flux_down, center - head(index + width));
  let available = state_a[index].water * 16u;
  for (var step = 0u; step < 32u && sum4_exceeds(left, right, up, down, available); step++) {
    left = left >> 1u;
    right = right >> 1u;
    up = up >> 1u;
    down = down >> 1u;
  }
  state_b[index].flux_left = left;
  state_b[index].flux_right = right;
  state_b[index].flux_up = up;
  state_b[index].flux_down = down;
}
