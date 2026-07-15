@compute @workgroup_size(8, 8)
fn pack_output(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (x >= params.geometry.y || z >= params.geometry.z) { return; }
  let source_index = cell_index(x + params.grid.z, z + params.grid.z);
  let output_index = z * params.geometry.y + x;
  output_data[output_index] = vec4<u32>(
    bitcast<u32>(state_a[source_index].height),
    state_a[source_index].hardness,
    state_a[source_index].sediment,
    bitcast<u32>(state_a[source_index].deposition),
  );
}

@compute @workgroup_size(8, 8)
fn pack_checkpoint(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (!in_grid(x, z)) { return; }
  let index = cell_index(x, z);
  let output_index = index * 2u;
  output_data[output_index] = vec4<u32>(
    bitcast<u32>(state_a[index].height),
    state_a[index].water,
    state_a[index].sediment,
    bitcast<u32>(state_a[index].deposition),
  );
  output_data[output_index + 1u] = vec4<u32>(
    state_b[index].flux_left,
    state_b[index].flux_right,
    state_b[index].flux_up,
    state_b[index].flux_down,
  );
}

@compute @workgroup_size(8, 8)
fn restore_checkpoint(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (!in_grid(x, z)) { return; }
  let index = cell_index(x, z);
  let input_index = index * 2u;
  let dynamic_state = output_data[input_index];
  let flux = output_data[input_index + 1u];
  state_a[index].height = bitcast<i32>(dynamic_state.x);
  state_a[index].water = dynamic_state.y;
  state_a[index].sediment = dynamic_state.z;
  state_a[index].deposition = bitcast<i32>(dynamic_state.w);
  state_a[index].velocity_x = 0;
  state_a[index].velocity_z = 0;
  state_b[index].flux_left = flux.x;
  state_b[index].flux_right = flux.y;
  state_b[index].flux_up = flux.z;
  state_b[index].flux_down = flux.w;
  state_b[index].capacity = 0u;
  atomicStore(&state_b[index].thermal_delta, 0);
}
