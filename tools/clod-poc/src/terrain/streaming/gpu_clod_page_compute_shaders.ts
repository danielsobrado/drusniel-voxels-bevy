import biomeRegionWgsl from "../../gpu/shaders/biome_region_field.wgsl?raw";
import { GPU_CLOD_VERTEX_FLOATS } from "./gpu_clod_resident_types.js";

export const GPU_CLOD_PAGE_WORKGROUP_SIZE = 64;

const PACKED_VERTEX = /* wgsl */ `
struct PackedVertex {
  positionMorph : vec4<f32>,
  normalBiome : vec4<f32>,
  paintSlots : vec4<f32>,
  paintWeights : vec4<f32>,
};
`;

export const GPU_CLOD_PACK_WGSL = /* wgsl */ `
${biomeRegionWgsl}
${PACKED_VERTEX}

struct FieldParams {
  editCount : u32,
  terrainSeed : i32,
  islandEnabled : u32,
  oceanRim : u32,
  seaLevel : f32,
  islandSpacingM : f32,
  islandRadiusM : f32,
  islandBlendM : f32,
  islandWarpStrengthM : f32,
  beachWidthM : f32,
  cliffWidthM : f32,
  worldRadiusM : f32,
  oceanRimDropM : f32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};

struct ChunkDescriptor {
  positionBaseF32 : u32,
  normalBaseF32 : u32,
  materialBaseF32 : u32,
  indexBaseU32 : u32,
  vertexCount : u32,
  indexCount : u32,
  destinationVertexBase : u32,
  destinationIndexBase : u32,
};

struct PackParams {
  descriptorCount : u32,
  totalVertexCount : u32,
  totalIndexCount : u32,
  _pad0 : u32,
};

@group(0) @binding(0) var<storage, read> sourcePositions : array<f32>;
@group(0) @binding(1) var<storage, read> sourceNormals : array<f32>;
@group(0) @binding(2) var<storage, read> sourceMaterials : array<f32>;
@group(0) @binding(3) var<storage, read> sourceIndices : array<u32>;
@group(0) @binding(4) var<storage, read> descriptors : array<ChunkDescriptor>;
@group(0) @binding(5) var<uniform> fieldParams : FieldParams;
@group(0) @binding(6) var<uniform> packParams : PackParams;
@group(0) @binding(7) var<storage, read_write> outputVertices : array<PackedVertex>;
@group(0) @binding(8) var<storage, read_write> outputIndices : array<u32>;

fn descriptorForVertex(vertexId : u32) -> u32 {
  for (var descriptorId = 0u; descriptorId < packParams.descriptorCount; descriptorId++) {
    let descriptor = descriptors[descriptorId];
    if (vertexId >= descriptor.destinationVertexBase && vertexId < descriptor.destinationVertexBase + descriptor.vertexCount) {
      return descriptorId;
    }
  }
  return 0xffffffffu;
}

fn descriptorForIndex(indexId : u32) -> u32 {
  for (var descriptorId = 0u; descriptorId < packParams.descriptorCount; descriptorId++) {
    let descriptor = descriptors[descriptorId];
    if (indexId >= descriptor.destinationIndexBase && indexId < descriptor.destinationIndexBase + descriptor.indexCount) {
      return descriptorId;
    }
  }
  return 0xffffffffu;
}

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn packVertices(@builtin(global_invocation_id) gid : vec3<u32>) {
  let destinationVertex = gid.x;
  if (destinationVertex >= packParams.totalVertexCount) { return; }
  let descriptorId = descriptorForVertex(destinationVertex);
  if (descriptorId == 0xffffffffu) { return; }
  let descriptor = descriptors[descriptorId];
  let localVertex = destinationVertex - descriptor.destinationVertexBase;
  let source3 = localVertex * 3u;
  let position = vec3<f32>(
    sourcePositions[descriptor.positionBaseF32 + source3],
    sourcePositions[descriptor.positionBaseF32 + source3 + 1u],
    sourcePositions[descriptor.positionBaseF32 + source3 + 2u],
  );
  let normal = vec3<f32>(
    sourceNormals[descriptor.normalBaseF32 + source3],
    sourceNormals[descriptor.normalBaseF32 + source3 + 1u],
    sourceNormals[descriptor.normalBaseF32 + source3 + 2u],
  );
  let paintValue = sourceMaterials[descriptor.materialBaseF32 + localVertex];
  let painted = paintValue > 0.5;
  let paintSlot = select(-1.0, paintValue - 1.0, painted);
  let biome = classifyBiomeRegionIslandAware(
    position.x,
    position.z,
    position.y,
    fieldParams.seaLevel,
    fieldParams.terrainSeed,
    fieldParams.islandEnabled != 0u,
    fieldParams.islandSpacingM,
    fieldParams.islandRadiusM,
    fieldParams.islandBlendM,
    fieldParams.islandWarpStrengthM,
  );
  outputVertices[destinationVertex] = PackedVertex(
    vec4<f32>(position, 0.0),
    vec4<f32>(normalize(normal), f32(biome)),
    vec4<f32>(paintSlot, -1.0, -1.0, -1.0),
    vec4<f32>(select(0.0, 1.0, painted), 0.0, 0.0, 0.0),
  );
}

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn packIndices(@builtin(global_invocation_id) gid : vec3<u32>) {
  let destinationIndex = gid.x;
  if (destinationIndex >= packParams.totalIndexCount) { return; }
  let descriptorId = descriptorForIndex(destinationIndex);
  if (descriptorId == 0xffffffffu) { return; }
  let descriptor = descriptors[descriptorId];
  let localIndex = destinationIndex - descriptor.destinationIndexBase;
  outputIndices[destinationIndex] = sourceIndices[descriptor.indexBaseU32 + localIndex] + descriptor.destinationVertexBase;
}
`;

// Weld hash slots store the OWNER'S INPUT VERTEX ID (+1), never an output id: every
// cross-invocation comparison reads the immutable input buffer, because WGSL gives no
// visibility guarantee for non-atomic storage writes between workgroups in one dispatch.
// The earlier output-id design compared against outputVertices written by other
// invocations and systematically exhausted probes on current Dawn (garbage reads made
// every positionsMatch fail). Output compaction happens in the separate
// assignWeldOutputs pass; dispatch-to-dispatch ordering makes its plain writes safe.
export const GPU_CLOD_WELD_RUNTIME_WGSL = /* wgsl */ `
${PACKED_VERTEX}

struct WeldParams {
  vertexCount : u32,
  indexCount : u32,
  hashMask : u32,
  maxProbe : u32,
  weldEpsilon : f32,
  normalDotMin : f32,
  materialEpsilon : f32,
  _pad0 : f32,
};

struct WeldCounters {
  vertexCount : atomic<u32>,
  indexCount : atomic<u32>,
  attributeConflicts : atomic<u32>,
  probeFailures : atomic<u32>,
};

@group(0) @binding(0) var<uniform> params : WeldParams;
@group(0) @binding(1) var<storage, read> inputVertices : array<PackedVertex>;
@group(0) @binding(2) var<storage, read> inputIndices : array<u32>;
@group(0) @binding(3) var<storage, read_write> hashSlots : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> vertexRemap : array<u32>;
@group(0) @binding(5) var<storage, read_write> outputVertices : array<PackedVertex>;
@group(0) @binding(6) var<storage, read_write> outputIndices : array<u32>;
@group(0) @binding(7) var<storage, read_write> counters : WeldCounters;
@group(0) @binding(8) var<storage, read_write> outputIdPlusOne : array<u32>;

fn hashMix(value : u32) -> u32 {
  var x = value;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);
}

fn quantizedHash(position : vec3<f32>) -> u32 {
  let inverseEpsilon = 1.0 / max(params.weldEpsilon, 1e-9);
  let q = vec3<i32>(round(position * inverseEpsilon));
  var hash = hashMix(bitcast<u32>(q.x));
  hash = hashMix(hash ^ bitcast<u32>(q.y));
  hash = hashMix(hash ^ bitcast<u32>(q.z));
  return max(1u, hash);
}

fn positionsMatch(a : PackedVertex, b : PackedVertex) -> bool {
  return all(abs(a.positionMorph.xyz - b.positionMorph.xyz) <= vec3<f32>(params.weldEpsilon));
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
fn weldVertices(@builtin(global_invocation_id) gid : vec3<u32>) {
  let vertexId = gid.x;
  if (vertexId >= params.vertexCount) { return; }
  let candidate = inputVertices[vertexId];
  let key = quantizedHash(candidate.positionMorph.xyz);
  let start = key & params.hashMask;
  for (var probe = 0u; probe < params.maxProbe; probe++) {
    let slotIndex = (start + probe) & params.hashMask;
    let claim = atomicCompareExchangeWeak(&hashSlots[slotIndex], 0u, vertexId + 1u);
    if (claim.exchanged) {
      vertexRemap[vertexId] = vertexId;
      return;
    }
    let ownerId = claim.old_value - 1u;
    let owner = inputVertices[ownerId];
    if (quantizedHash(owner.positionMorph.xyz) != key) { continue; }
    if (!positionsMatch(candidate, owner)) { continue; }
    if (!attributesMatch(candidate, owner)) {
      atomicAdd(&counters.attributeConflicts, 1u);
      continue;
    }
    vertexRemap[vertexId] = ownerId;
    return;
  }
  atomicAdd(&counters.probeFailures, 1u);
  vertexRemap[vertexId] = 0xffffffffu;
}

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn assignWeldOutputs(@builtin(global_invocation_id) gid : vec3<u32>) {
  let vertexId = gid.x;
  if (vertexId >= params.vertexCount) { return; }
  if (vertexRemap[vertexId] != vertexId) { return; }
  let outputId = atomicAdd(&counters.vertexCount, 1u);
  outputVertices[outputId] = inputVertices[vertexId];
  outputIdPlusOne[vertexId] = outputId + 1u;
}

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn weldIndices(@builtin(global_invocation_id) gid : vec3<u32>) {
  let triangleId = gid.x;
  let source = triangleId * 3u;
  if (source + 2u >= params.indexCount) { return; }
  let canonicalA = vertexRemap[inputIndices[source]];
  let canonicalB = vertexRemap[inputIndices[source + 1u]];
  let canonicalC = vertexRemap[inputIndices[source + 2u]];
  if (canonicalA == 0xffffffffu || canonicalB == 0xffffffffu || canonicalC == 0xffffffffu) { return; }
  let a = outputIdPlusOne[canonicalA] - 1u;
  let b = outputIdPlusOne[canonicalB] - 1u;
  let c = outputIdPlusOne[canonicalC] - 1u;
  if (a == b || b == c || a == c) { return; }
  let writeBase = atomicAdd(&counters.indexCount, 3u);
  outputIndices[writeBase] = a;
  outputIndices[writeBase + 1u] = b;
  outputIndices[writeBase + 2u] = c;
}
`;

// Legacy duplicate of GPU_CLOD_SIMPLIFY_RUNTIME_WGSL kept for contract tests; the
// pipeline imports the copy in gpu_clod_simplify_runtime_shader.ts. Same race-free
// design: hash slots store the OWNER'S INPUT VERTEX ID (+1) so every comparison reads
// the immutable input buffer, and assignSimplifyOutputs compacts canonical vertices.
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
@group(0) @binding(3) var<storage, read_write> hashSlots : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> vertexRemap : array<u32>;
@group(0) @binding(5) var<storage, read_write> outputVertices : array<PackedVertex>;
@group(0) @binding(6) var<storage, read_write> outputIndices : array<u32>;
@group(0) @binding(7) var<storage, read_write> counters : SimplifyCounters;
@group(0) @binding(8) var<storage, read_write> outputIdPlusOne : array<u32>;

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
    let claim = atomicCompareExchangeWeak(&hashSlots[slotIndex], 0u, vertexId + 1u);
    if (claim.exchanged) {
      vertexRemap[vertexId] = vertexId;
      return;
    }
    if (locked) { continue; }
    let ownerId = claim.old_value - 1u;
    let owner = inputVertices[ownerId];
    if (isLocked(owner.positionMorph.xyz)) { continue; }
    if (!sameCluster(candidate.positionMorph.xyz, owner.positionMorph.xyz)) { continue; }
    if (!attributesMatch(candidate, owner)) {
      atomicAdd(&counters.attributeConflicts, 1u);
      continue;
    }
    let error = distance(candidate.positionMorph.xyz, owner.positionMorph.xyz);
    atomicMax(&counters.maxErrorBits, bitcast<u32>(max(0.0, error)));
    vertexRemap[vertexId] = ownerId;
    return;
  }
  atomicAdd(&counters.probeFailures, 1u);
  vertexRemap[vertexId] = 0xffffffffu;
}

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn assignSimplifyOutputs(@builtin(global_invocation_id) gid : vec3<u32>) {
  let vertexId = gid.x;
  if (vertexId >= params.vertexCount) { return; }
  if (vertexRemap[vertexId] != vertexId) { return; }
  let outputId = atomicAdd(&counters.vertexCount, 1u);
  outputVertices[outputId] = inputVertices[vertexId];
  outputIdPlusOne[vertexId] = outputId + 1u;
}

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn simplifyIndices(@builtin(global_invocation_id) gid : vec3<u32>) {
  let triangleId = gid.x;
  let source = triangleId * 3u;
  if (source + 2u >= params.indexCount) { return; }
  let canonicalA = vertexRemap[inputIndices[source]];
  let canonicalB = vertexRemap[inputIndices[source + 1u]];
  let canonicalC = vertexRemap[inputIndices[source + 2u]];
  if (canonicalA == 0xffffffffu || canonicalB == 0xffffffffu || canonicalC == 0xffffffffu) { return; }
  let a = outputIdPlusOne[canonicalA] - 1u;
  let b = outputIdPlusOne[canonicalB] - 1u;
  let c = outputIdPlusOne[canonicalC] - 1u;
  if (a == b || b == c || a == c) { return; }
  let writeBase = atomicAdd(&counters.indexCount, 3u);
  outputIndices[writeBase] = a;
  outputIndices[writeBase + 1u] = b;
  outputIndices[writeBase + 2u] = c;
}
`;

export const GPU_CLOD_INDEX_OFFSET_WGSL = /* wgsl */ `
struct IndexParams {
  indexCount : u32,
  destinationOffset : u32,
  vertexOffset : u32,
  _pad0 : u32,
};
@group(0) @binding(0) var<uniform> params : IndexParams;
@group(0) @binding(1) var<storage, read> sourceIndices : array<u32>;
@group(0) @binding(2) var<storage, read_write> destinationIndices : array<u32>;
@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn offsetIndices(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.indexCount) { return; }
  destinationIndices[params.destinationOffset + gid.x] = sourceIndices[gid.x] + params.vertexOffset;
}
`;

export const GPU_CLOD_MESHLET_WGSL = /* wgsl */ `
${PACKED_VERTEX}
const INVALID_INDEX : u32 = 0xffffffffu;

struct MeshletParams {
  indexCount : u32,
  trianglesPerMeshlet : u32,
  meshletCount : u32,
  _pad0 : u32,
};

@group(0) @binding(0) var<uniform> params : MeshletParams;
@group(0) @binding(1) var<storage, read> vertices : array<PackedVertex>;
@group(0) @binding(2) var<storage, read> indices : array<u32>;
@group(0) @binding(3) var<storage, read_write> headers : array<u32>;
@group(0) @binding(4) var<storage, read_write> bounds : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> indirect : array<u32>;

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn buildMeshlets(@builtin(global_invocation_id) gid : vec3<u32>) {
  let meshletId = gid.x;
  if (meshletId >= params.meshletCount) { return; }
  let firstTriangle = meshletId * params.trianglesPerMeshlet;
  let firstIndex = firstTriangle * 3u;
  let indexCount = min(params.trianglesPerMeshlet * 3u, params.indexCount - firstIndex);
  // Bounds cover both the base position and the fully root-morphed position
  // (y + positionMorph.w at uRootMorphInfluence = 1) so the per-frame frustum
  // cull stays conservative for every morph influence in [0, 1].
  var minPosition = vec3<f32>(3.402823e38);
  var maxPosition = vec3<f32>(-3.402823e38);
  for (var localIndex = 0u; localIndex < indexCount; localIndex++) {
    let packed = vertices[indices[firstIndex + localIndex]].positionMorph;
    let morphed = vec3<f32>(packed.x, packed.y + packed.w, packed.z);
    minPosition = min(minPosition, min(packed.xyz, morphed));
    maxPosition = max(maxPosition, max(packed.xyz, morphed));
  }
  let center = (minPosition + maxPosition) * 0.5;
  var radius = 0.0;
  for (var localIndex = 0u; localIndex < indexCount; localIndex++) {
    let packed = vertices[indices[firstIndex + localIndex]].positionMorph;
    let morphed = vec3<f32>(packed.x, packed.y + packed.w, packed.z);
    radius = max(radius, max(distance(packed.xyz, center), distance(morphed, center)));
  }
  let header = meshletId * 8u;
  headers[header] = firstIndex;
  headers[header + 1u] = indexCount;
  headers[header + 2u] = INVALID_INDEX;
  headers[header + 3u] = 0u;
  headers[header + 4u] = firstTriangle;
  headers[header + 5u] = indexCount;
  headers[header + 6u] = 0u;
  headers[header + 7u] = 0u;
  bounds[meshletId] = vec4<f32>(center, radius);
  let indirectBase = meshletId * 5u;
  indirect[indirectBase] = indexCount;
  indirect[indirectBase + 1u] = 1u;
  indirect[indirectBase + 2u] = firstIndex;
  indirect[indirectBase + 3u] = 0u;
  indirect[indirectBase + 4u] = 0u;
}
`;

export const GPU_CLOD_MESHLET_HIERARCHY_WGSL = /* wgsl */ `
const INVALID_INDEX : u32 = 0xffffffffu;

struct HierarchyParams {
  childStart : u32,
  childCount : u32,
  parentStart : u32,
  parentCount : u32,
  fanout : u32,
  level : u32,
  childIsLeaf : u32,
  _pad0 : u32,
};

@group(0) @binding(0) var<storage, read_write> leafHeaders : array<u32>;
@group(0) @binding(1) var<storage, read> leafBounds : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> hierarchyHeaders : array<u32>;
@group(0) @binding(3) var<storage, read_write> hierarchyBounds : array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params : HierarchyParams;

fn childBounds(child : u32) -> vec4<f32> {
  if (params.childIsLeaf != 0u) { return leafBounds[child]; }
  return hierarchyBounds[child];
}

@compute @workgroup_size(${GPU_CLOD_PAGE_WORKGROUP_SIZE})
fn buildHierarchy(@builtin(global_invocation_id) gid : vec3<u32>) {
  let localParent = gid.x;
  if (localParent >= params.parentCount) { return; }
  let parent = params.parentStart + localParent;
  let firstChild = params.childStart + localParent * params.fanout;
  let childCount = min(params.fanout, params.childStart + params.childCount - firstChild);
  var minPosition = vec3<f32>(3.402823e38);
  var maxPosition = vec3<f32>(-3.402823e38);
  for (var offset = 0u; offset < childCount; offset++) {
    let sphere = childBounds(firstChild + offset);
    minPosition = min(minPosition, sphere.xyz - vec3<f32>(sphere.w));
    maxPosition = max(maxPosition, sphere.xyz + vec3<f32>(sphere.w));
  }
  let center = (minPosition + maxPosition) * 0.5;
  var radius = 0.0;
  for (var offset = 0u; offset < childCount; offset++) {
    let sphere = childBounds(firstChild + offset);
    radius = max(radius, distance(center, sphere.xyz) + sphere.w);
    if (params.childIsLeaf != 0u) {
      leafHeaders[(firstChild + offset) * 8u + 2u] = parent;
    } else {
      hierarchyHeaders[(firstChild + offset) * 4u + 2u] = parent;
    }
  }
  let header = parent * 4u;
  hierarchyHeaders[header] = firstChild;
  hierarchyHeaders[header + 1u] = childCount;
  hierarchyHeaders[header + 2u] = INVALID_INDEX;
  hierarchyHeaders[header + 3u] = params.level;
  hierarchyBounds[parent] = vec4<f32>(center, radius);
}
`;

export const GPU_CLOD_PACKED_VERTEX_FLOATS = GPU_CLOD_VERTEX_FLOATS;
