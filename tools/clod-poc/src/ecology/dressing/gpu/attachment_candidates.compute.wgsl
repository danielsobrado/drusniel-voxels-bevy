@group(0) @binding(0) var<storage, read> environments: array<DressingEnvironment>;
@group(0) @binding(1) var<storage, read_write> terrain_candidates: array<DressingInstance>;
@group(0) @binding(2) var<storage, read_write> attachment_candidates: array<DressingInstance>;
@group(0) @binding(3) var<storage, read_write> visible_instances: array<DressingInstance>;
@group(0) @binding(4) var<storage, read_write> indirect_words: array<u32>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= arrayLength(&terrain_candidates)) { return; }
  let parent = terrain_candidates[id.x];
  if (parent.identity.x < DEAD_LOG_FRESH || parent.identity.x > DEAD_LOG_ROTTEN) { return; }
  let output = atomicAdd(&counters[1], 1u);
  if (output >= arrayLength(&attachment_candidates)) {
    atomicAdd(&counters[3], 1u);
    return;
  }
  attachment_candidates[output] = parent;
  attachment_candidates[output].identity.x = 9u;
}
