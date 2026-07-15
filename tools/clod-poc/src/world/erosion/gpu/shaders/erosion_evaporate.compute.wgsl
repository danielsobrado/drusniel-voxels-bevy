@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (!in_grid(x, z)) { return; }
  let index = cell_index(x, z);
  state_a[index].water = mul_q16(state_a[index].water, params.rain.w);
  if (in_interior(x, z)) {
    state_a[index].sediment = atomicLoad(&sediment_scratch[index]);
    return;
  }
  state_a[index].water = 0u;
  state_a[index].sediment = 0u;
  state_b[index].flux_left = 0u;
  state_b[index].flux_right = 0u;
  state_b[index].flux_up = 0u;
  state_b[index].flux_down = 0u;
  state_a[index].velocity_x = 0;
  state_a[index].velocity_z = 0;
}
