@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (!in_grid(x, z) || !in_interior(x, z)) { return; }
  let index = cell_index(x, z);
  if (state_a[index].water == 0u) {
    state_b[index].capacity = 0u;
    return;
  }
  let width = params.grid.x;
  let center = state_a[index].height;
  let max_drop = u32(max(0, max(max(center - state_a[index - 1u].height, center - state_a[index + 1u].height),
    max(center - state_a[index - width].height, center - state_a[index + width].height))));
  let slope = max(params.sediment.x, ratio_q16_small(max_drop, params.geometry.x));
  let speed = approximate_hypot(state_a[index].velocity_x, state_a[index].velocity_z);
  let speed_q16 = min(Q16_ONE, ratio_q16_small(speed, max(1u, params.water.x)));
  let softness = HARDNESS_MAX - state_a[index].hardness;
  var capacity = state_a[index].water * 16u;
  capacity = mul_q16(capacity, speed_q16);
  capacity = mul_q16(capacity, slope);
  capacity = mul_q16(capacity, params.geometry.x << 8u);
  capacity = mul_q16(capacity, params.water.y);
  capacity = mul_q16(capacity, softness);
  state_b[index].capacity = capacity;
}
