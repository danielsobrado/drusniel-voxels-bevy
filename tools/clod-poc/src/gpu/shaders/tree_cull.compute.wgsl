struct TreeGpuCandidate {
  positionScale: vec4<f32>,
  rotationSpeciesSeedFlags: vec4<f32>,
};

struct TreeGpuVisibleRecord {
  candidateIndex: u32,
  lod: u32,
  species: u32,
  reserved: u32,
};

struct TreeGpuCullParams {
  centerXZ: vec2<f32>,
  nearDistance: f32,
  midDistance: f32,
  farDistance: f32,
  impostorDistance: f32,
  cullDistancePaddingM: f32,
  lodHysteresisM: f32,
  candidateCount: u32,
  maxVisible: u32,
  lodCount: u32,
  debugFlags: u32,
  cameraXZ: vec2<f32>,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> candidates: array<TreeGpuCandidate>;
@group(0) @binding(1) var<storage, read_write> visibleRecords: array<TreeGpuVisibleRecord>;
@group(0) @binding(2) var<storage, read_write> visibleCount: atomic<u32>;
@group(0) @binding(3) var<uniform> params: TreeGpuCullParams;

override TREE_GPU_WORKGROUP_SIZE: u32 = 64u;

fn tree_lod_for_distance(distanceM: f32) -> u32 {
  if (distanceM <= params.nearDistance) {
    return 0u;
  }
  if (distanceM <= params.midDistance) {
    return 1u;
  }
  if (distanceM <= params.farDistance) {
    return 2u;
  }
  return 3u;
}

@compute @workgroup_size(TREE_GPU_WORKGROUP_SIZE)
fn tree_cull(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let candidateIndex = globalId.x;
  if (candidateIndex >= params.candidateCount) {
    return;
  }

  let candidate = candidates[candidateIndex];
  let worldXZ = candidate.positionScale.xz;
  let delta = worldXZ - params.centerXZ;
  let distanceM = length(delta);
  if (distanceM > params.impostorDistance + params.cullDistancePaddingM) {
    return;
  }

  let outputIndex = atomicAdd(&visibleCount, 1u);
  if (outputIndex >= params.maxVisible) {
    return;
  }

  visibleRecords[outputIndex] = TreeGpuVisibleRecord(
    candidateIndex,
    tree_lod_for_distance(distanceM),
    u32(max(candidate.rotationSpeciesSeedFlags.y, 0.0)),
    0u,
  );
}
