@compute @workgroup_size(8, 8)
fn clear_delta(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!in_grid(gid.x, gid.y)) { return; }
  atomicStore(&state_b[cell_index(gid.x, gid.y)].thermal_delta, 0);
}

@compute @workgroup_size(8, 8)
fn accumulate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  let border = params.grid.z + 1u;
  if (!in_grid(x, z) || x < border || z < border || x >= params.grid.x - border || z >= params.grid.y - border) { return; }
  let index = cell_index(x, z);
  let width = params.grid.x;
  var target = index - 1u;
  if (state_a[index + 1u].height < state_a[target].height) { target = index + 1u; }
  if (state_a[index - width].height < state_a[target].height) { target = index - width; }
  if (state_a[index + width].height < state_a[target].height) { target = index + width; }
  let difference = state_a[index].height - state_a[target].height;
  let hardness_byte = state_a[index].hardness >> 8u;
  let talus_limit = i32(talus_table[hardness_byte]);
  if (difference <= talus_limit) { return; }
  let excess = u32(difference - talus_limit);
  let transfer = min(excess >> 1u, mul_q16(excess, params.sediment.w));
  if (transfer == 0u) { return; }
  atomicAdd(&state_b[index].thermal_delta, -i32(transfer));
  atomicAdd(&state_b[target].thermal_delta, i32(transfer));
}

@compute @workgroup_size(8, 8)
fn apply_delta(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!in_grid(gid.x, gid.y)) { return; }
  let index = cell_index(gid.x, gid.y);
  let delta_height = atomicLoad(&state_b[index].thermal_delta);
  state_a[index].height = state_a[index].height + delta_height;
  state_a[index].deposition = state_a[index].deposition + delta_height * 256;
}
