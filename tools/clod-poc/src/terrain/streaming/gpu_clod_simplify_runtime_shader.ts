import { GPU_CLOD_PAGE_WORKGROUP_SIZE } from "./gpu_clod_page_compute_shaders.js";

const PACKED_VERTEX = /* wgsl */ `
struct PackedVertex {
  positionMorph : vec4<f32>,
  normalBiome : vec4<f32>,
  paintSlots : vec4<f32>,
  paintWeights : vec4<f32>,
};
`;

export const GPU_CLOD_SIMPLIFY_RUNTIME_WGSL = /* wgsl */ `
${PACKED_VERTEX}

struct SimplifyParams {
  vertexCount : u32,
  indexCount : u32,
  hashMask : u32,
  maxProbe : u32,
  clusterSize : f32,
  borderEpsilon : f32,
  normalDotMin : f32,
  materialEpsilon : f32,
  minX : f32,
  minZ : f32,
  maxX : f32,
  maxZ : f32,
  _pad0 : vec4<u32>,
};

struct HashSlot {
  key : atomic<u32>,
  valuePlusOne : atomic<u32>,
};

struct SimplifyCounters {
  vertexCount : atomic<u32>,
  indexCount : atomic<u32>,
  protectedVertices : atomic<u32>,
  attributeConflicts : atomic<u32>,
  probeFailures : atomic<u32>,
  maxErrorBits : atomic<u32>,
};

@group(0) @binding(0) var<uniform> params : SimplifyParams;
@group(0) @binding(1) var<storage, read> inputVertices : array<PackedVertex>;
@group(0) @binding(2) var<storage, read> inputIndices : array<u32>;
@group(0) @binding(3) var<storage, read_write> hashSlots : array<HashSlot>;
@group(0) @binding(4) var<storage, read_write> vertexRemap : array<u32>;
@group(0) @binding(5) var<storage, read_write> outputVertices : array<PackedVertex>;
@group(0) @binding(6) var<storage, read_write> outputIndices : array<u32>;
@group(0) @binding(7) var<storage, read_write> counters : SimplifyCounters;

fn hashMix(value : u32) -> u32 {
  var x = value;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);
}

fn isLocked(position : vec3<f32>) -> bool {
  return abs(position.x - params.minX) <= params.borderEpsilon
    || abs(position.x - params.maxX) <= params.borderEpsilon
    || abs(position.z - params.minZ) <= params.borderEpsilon
    || abs(position.z - params.maxZ) <= params.borderEpsilon;
}

fn clusterCell(position : vec3<f32>) -> vec3<i32> {
  let inverseSize = 1.0 / max(params.clusterSize, 1e-6);
  return vec3<i32>(floor(position * inverseSize));
}

fn clusterHash(position : vec3<f32>, vertexId : u32, locked : bool) -> u32 {
  if (locked) { return max(1u, hashMix(vertexId ^ 0xa511e9b3u)); }
  let q = clusterCell(position);
  var hash = hashMix(bitcast<u32>(q.x));
  hash = hashMix(hash ^ bitcast<u32>(q.y));
  hash = hashMix(hash ^ bitcast<u32>(q.z));
  return max(1u, hash);
}

fn sameCluster(a : vec3<f32>, b : vec3<f32>) -> bool {
  return all(clusterCell(a) == clusterCell(b));
}

fn attributesMatch(a : PackedVertex, b : PackedVertex) -> bool {
  let normalDot = dot(normalize(a.normalBiome.xyz), normalize(b.normalBiome.xyz));
  let slotDelta = max(
    max(abs(a.paintSlots.x - b.paintSlots.x), abs(a.paintSlots.y - b.paintSlots.y)),
    max(abs(a.paintSlots.z - b.paintSlots.z), abs(a.paintSlots.w - b.paintSlots.w)),
  );
  let weightDelta = max(
    max(abs(a.paintWeights.x - b.paintWeights.x), abs(a.paintWeights.y - b.paintWeights.y)),
    max(abs(a.paintWeights.z - b.paintWeights.z), abs(a.paintWeights.w - b.paintWeights.w)),
  );
  return normalDot >= params.normalDotMin
    && slotDelta <= params.materialEpsilon
    && weightDelta <= params.materialEpsilon
    && abs(a.normalBiome.w - b.normalBiome.w) <= 0.5;
}

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn simplifyVertices(@builtin(global_invocation_id) gid : vec3<u32>) {
  let vertexId = gid.x;
  if (vertexId >= params.vertexCount) { return; }
  let candidate = inputVertices[vertexId];
  let locked = isLocked(candidate.positionMorph.xyz);
  if (locked) { atomicAdd(&counters.protectedVertices, 1u); }
  let key = clusterHash(candidate.positionMorph.xyz, vertexId, locked);
  let start = key & params.hashMask;
  for (var probe = 0u; probe < params.maxProbe; probe++) {
    let slotIndex = (start + probe) & params.hashMask;
    let claim = atomicCompareExchangeWeak(&hashSlots[slotIndex].key, 0u, key);
    if (claim.exchanged) {
      let outputId = atomicAdd(&counters.vertexCount, 1u);
      outputVertices[outputId] = candidate;
      atomicStore(&hashSlots[slotIndex].valuePlusOne, outputId + 1u);
      vertexRemap[vertexId] = outputId;
      return;
    }
    if (claim.old_value != key) { continue; }
    var valuePlusOne = atomicLoad(&hashSlots[slotIndex].valuePlusOne);
    let publishWaitLimit = max(1024u, params.maxProbe * 64u);
    for (var publishWait = 0u; publishWait < publishWaitLimit && valuePlusOne == 0u; publishWait++) {
      valuePlusOne = atomicLoad(&hashSlots[slotIndex].valuePlusOne);
    }
    if (valuePlusOne == 0u) {
      atomicAdd(&counters.probeFailures, 1u);
      vertexRemap[vertexId] = 0xffffffffu;
      return;
    }
    let outputId = valuePlusOne - 1u;
    let representative = outputVertices[outputId];
    let representativeLocked = isLocked(representative.positionMorph.xyz);
    if (locked || representativeLocked || !sameCluster(candidate.positionMorph.xyz, representative.positionMorph.xyz)) {
      continue;
    }
    if (!attributesMatch(candidate, representative)) {
      atomicAdd(&counters.attributeConflicts, 1u);
      continue;
    }
    let error = distance(candidate.positionMorph.xyz, representative.positionMorph.xyz);
    atomicMax(&counters.maxErrorBits, bitcast<u32>(max(0.0, error)));
    vertexRemap[vertexId] = outputId;
    return;
  }
  atomicAdd(&counters.probeFailures, 1u);
  vertexRemap[vertexId] = 0xffffffffu;
}

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn simplifyIndices(@builtin(global_invocation_id) gid : vec3<u32>) {
  let triangleId = gid.x;
  let source = triangleId * 3u;
  if (source + 2u >= params.indexCount) { return; }
  let a = vertexRemap[inputIndices[source]];
  let b = vertexRemap[inputIndices[source + 1u]];
  let c = vertexRemap[inputIndices[source + 2u]];
  if (a == 0xffffffffu || b == 0xffffffffu || c == 0xffffffffu || a == b || b == c || a == c) { return; }
  let target = atomicAdd(&counters.indexCount, 3u);
  outputIndices[target] = a;
  outputIndices[target + 1u] = b;
  outputIndices[target + 2u] = c;
}
`;
