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
