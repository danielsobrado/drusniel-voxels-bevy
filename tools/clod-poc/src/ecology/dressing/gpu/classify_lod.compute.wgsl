@group(0) @binding(0) var<storage, read> environments: array<DressingEnvironment>;
@group(0) @binding(1) var<storage, read_write> terrain_candidates: array<DressingInstance>;
@group(0) @binding(2) var<storage, read_write> attachment_candidates: array<DressingInstance>;
@group(0) @binding(3) var<storage, read_write> visible_instances: array<DressingInstance>;
@group(0) @binding(4) var<storage, read_write> indirect_words: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let terrain_count = atomicLoad(&counters[0]);
  let attachment_count = atomicLoad(&counters[1]);
  let total = terrain_count + attachment_count;
  if (id.x >= total || id.x >= arrayLength(&visible_instances)) { return; }
  var instance: DressingInstance;
  if (id.x < terrain_count) {
    instance = terrain_candidates[id.x];
  } else {
    instance = attachment_candidates[id.x - terrain_count];
  }
  visible_instances[id.x] = instance;
  let group = min(instance.identity.x - 1u, DRESSING_CLASS_COUNT - 1u);
  atomicAdd(&indirect_words[group * 5u + 1u], 1u);
  atomicAdd(&counters[2], 1u);
}
