import { TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { treeLodDistances } from "./tree_lod.js";

export const TREE_GPU_CANDIDATE_FLOATS = 8;
export const TREE_GPU_CANDIDATE_BYTES = TREE_GPU_CANDIDATE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const TREE_GPU_VISIBLE_U32S = 4;
export const TREE_GPU_VISIBLE_BYTES = TREE_GPU_VISIBLE_U32S * Uint32Array.BYTES_PER_ELEMENT;
export const TREE_GPU_CULL_PARAM_WORDS = 16;
export const TREE_GPU_CULL_PARAM_BYTES = TREE_GPU_CULL_PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT;

export type TreeGpuLodIndex = 0 | 1 | 2 | 3;

export interface TreeGpuCandidate {
  worldX: number;
  worldY: number;
  worldZ: number;
  scale: number;
  rotationY: number;
  species: number;
  seed: number;
  flags: number;
}

export interface TreeGpuVisibleRecord {
  candidateIndex: number;
  lod: TreeGpuLodIndex;
  species: number;
  reserved: number;
}

export interface TreeGpuCullParams {
  centerX: number;
  centerZ: number;
  cameraX: number;
  cameraZ: number;
  nearDistance: number;
  midDistance: number;
  farDistance: number;
  impostorDistance: number;
  cullDistancePaddingM: number;
  lodHysteresisM: number;
  candidateCount: number;
  maxVisible: number;
  lodCount: number;
  debugFlags: number;
}

export function treeGpuSpeciesId(species: TreeSpeciesId): number {
  return TREE_SPECIES.indexOf(species);
}

export function treeGpuSpeciesFromId(id: number): TreeSpeciesId {
  return TREE_SPECIES[Math.max(0, Math.min(TREE_SPECIES.length - 1, Math.floor(id)))] ?? "oak";
}

export function treeGpuLodFromIndex(index: number): TreeLod {
  if (index === 0) return "near";
  if (index === 1) return "mid";
  if (index === 2) return "far";
  return "impostor";
}

export function treeGpuLodIndex(lod: TreeLod): TreeGpuLodIndex {
  if (lod === "near") return 0;
  if (lod === "mid") return 1;
  if (lod === "far") return 2;
  return 3;
}

export function packTreeGpuCandidates(candidates: readonly TreeGpuCandidate[]): Float32Array {
  const packed = new Float32Array(candidates.length * TREE_GPU_CANDIDATE_FLOATS);
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const offset = i * TREE_GPU_CANDIDATE_FLOATS;
    packed[offset] = candidate.worldX;
    packed[offset + 1] = candidate.worldY;
    packed[offset + 2] = candidate.worldZ;
    packed[offset + 3] = candidate.scale;
    packed[offset + 4] = candidate.rotationY;
    packed[offset + 5] = candidate.species;
    packed[offset + 6] = candidate.seed;
    packed[offset + 7] = candidate.flags;
  }
  return packed;
}

export function unpackTreeGpuCandidate(packed: Float32Array, index: number): TreeGpuCandidate {
  const offset = index * TREE_GPU_CANDIDATE_FLOATS;
  return {
    worldX: packed[offset] ?? 0,
    worldY: packed[offset + 1] ?? 0,
    worldZ: packed[offset + 2] ?? 0,
    scale: packed[offset + 3] ?? 1,
    rotationY: packed[offset + 4] ?? 0,
    species: packed[offset + 5] ?? 0,
    seed: packed[offset + 6] ?? 0,
    flags: packed[offset + 7] ?? 0,
  };
}

export function unpackTreeGpuVisibleRecords(
  packed: Uint32Array,
  count = Math.floor(packed.length / TREE_GPU_VISIBLE_U32S),
): TreeGpuVisibleRecord[] {
  const records: TreeGpuVisibleRecord[] = [];
  const limit = Math.min(count, Math.floor(packed.length / TREE_GPU_VISIBLE_U32S));
  for (let i = 0; i < limit; i++) {
    const offset = i * TREE_GPU_VISIBLE_U32S;
    records.push({
      candidateIndex: packed[offset] ?? 0,
      lod: Math.min(3, packed[offset + 1] ?? 0) as TreeGpuLodIndex,
      species: packed[offset + 2] ?? 0,
      reserved: packed[offset + 3] ?? 0,
    });
  }
  return records;
}

export function makeTreeGpuCullParams(
  settings: TreeSettings,
  input: {
    centerX: number;
    centerZ: number;
    cameraX?: number;
    cameraZ?: number;
    candidateCount: number;
    maxVisible?: number;
  },
): TreeGpuCullParams {
  const distances = treeLodDistances(settings);
  return {
    centerX: input.centerX,
    centerZ: input.centerZ,
    cameraX: input.cameraX ?? input.centerX,
    cameraZ: input.cameraZ ?? input.centerZ,
    nearDistance: distances.near,
    midDistance: distances.mid,
    farDistance: distances.far,
    impostorDistance: distances.impostor,
    cullDistancePaddingM: settings.gpu.cullDistancePaddingM,
    lodHysteresisM: settings.gpu.lodHysteresisM,
    candidateCount: Math.max(0, Math.floor(input.candidateCount)),
    maxVisible: Math.max(0, Math.floor(input.maxVisible ?? settings.gpu.maxVisible)),
    lodCount: 4,
    debugFlags: 0,
  };
}

export function packTreeGpuCullParams(
  params: TreeGpuCullParams,
  scratch: ArrayBuffer = new ArrayBuffer(TREE_GPU_CULL_PARAM_BYTES),
): ArrayBuffer {
  const f32 = new Float32Array(scratch);
  const u32 = new Uint32Array(scratch);
  f32.fill(0);
  u32.fill(0);
  f32[0] = params.centerX;
  f32[1] = params.centerZ;
  f32[2] = params.nearDistance;
  f32[3] = params.midDistance;
  f32[4] = params.farDistance;
  f32[5] = params.impostorDistance;
  f32[6] = params.cullDistancePaddingM;
  f32[7] = params.lodHysteresisM;
  u32[8] = params.candidateCount >>> 0;
  u32[9] = params.maxVisible >>> 0;
  u32[10] = params.lodCount >>> 0;
  u32[11] = params.debugFlags >>> 0;
  f32[12] = params.cameraX;
  f32[13] = params.cameraZ;
  return scratch;
}

export function classifyTreeCandidateCpu(
  candidate: Pick<TreeGpuCandidate, "worldX" | "worldZ" | "species">,
  params: TreeGpuCullParams,
): TreeGpuVisibleRecord | null {
  const distance = Math.hypot(candidate.worldX - params.centerX, candidate.worldZ - params.centerZ);
  if (distance > params.impostorDistance + params.cullDistancePaddingM) return null;
  const lod = distance <= params.nearDistance
    ? 0
    : distance <= params.midDistance
      ? 1
      : distance <= params.farDistance
        ? 2
        : 3;
  return {
    candidateIndex: 0,
    lod,
    species: Math.max(0, Math.floor(candidate.species)),
    reserved: 0,
  };
}
