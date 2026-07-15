@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (!in_grid(x, z) || !in_interior(x, z)) { return; }
  let index = cell_index(x, z);
  let hash = hash_u32(params.geometry.w, x - params.grid.z, z - params.grid.z, params.grid.w);
  let centered = i32((hash >> 16u) & 65535u) - 32768;
  let variation = (centered * i32(params.rain.y)) / 32768;
  let factor = u32(max(0, i32(Q16_ONE) + variation));
  state_a[index].water = state_a[index].water + mul_q16(params.rain.x, factor);
}
