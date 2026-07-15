@group(0) @binding(0) var<storage, read> environments: array<DressingEnvironment>;
@group(0) @binding(1) var<storage, read_write> terrain_candidates: array<DressingInstance>;
@group(0) @binding(2) var<storage, read_write> attachment_candidates: array<DressingInstance>;
@group(0) @binding(3) var<storage, read_write> visible_instances: array<DressingInstance>;
@group(0) @binding(4) var<storage, read_write> indirect_words: array<u32>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= arrayLength(&environments)) { return; }
  let class_id = (id.x % DRESSING_CLASS_COUNT) + 1u;
  if (!dressing_accept(class_id, environments[id.x])) { return; }
  let output = atomicAdd(&counters[0], 1u);
  if (output >= arrayLength(&terrain_candidates)) {
    atomicAdd(&counters[3], 1u);
    return;
  }
  terrain_candidates[output].identity.x = class_id;
  terrain_candidates[output].transform_0 = environments[id.x].position_water_depth;
}
