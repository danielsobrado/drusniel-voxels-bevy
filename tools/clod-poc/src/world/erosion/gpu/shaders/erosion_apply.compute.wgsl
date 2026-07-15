@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let z = gid.y;
  if (!in_grid(x, z) || !in_interior(x, z)) { return; }
  let index = cell_index(x, z);
  let suspended = state_a[index].sediment;
  let capacity = state_b[index].capacity;
  if (suspended < capacity) {
    let deficit = capacity - suspended;
    let softness = HARDNESS_MAX - state_a[index].hardness;
    let hardness_limit = mul_q16(params.sediment.y, softness);
    let requested = min(hardness_limit, mul_q16(deficit, params.water.z));
    let height_units = requested / 256u;
    if (height_units == 0u) { return; }
    let actual = height_units * 256u;
    state_a[index].height = state_a[index].height - i32(height_units);
    state_a[index].sediment = suspended + actual;
    state_a[index].deposition = state_a[index].deposition - i32(actual);
    return;
  }
  if (suspended == capacity) { return; }
  let excess = suspended - capacity;
  let requested = min(params.sediment.z, mul_q16(excess, params.water.w));
  let height_units = requested / 256u;
  if (height_units == 0u) { return; }
  let actual = min(suspended, height_units * 256u);
  state_a[index].height = state_a[index].height + i32(actual / 256u);
  state_a[index].sediment = suspended - actual;
  state_a[index].deposition = state_a[index].deposition + i32(actual);
}
