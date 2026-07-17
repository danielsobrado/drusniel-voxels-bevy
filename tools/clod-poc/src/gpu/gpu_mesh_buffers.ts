import { getTerrainFieldCoreConfig, type ResolvedDigEdit } from "./terrain_field_core.js";
import type { TerrainFieldConfig } from "../terrain/terrain.js";
import type { WorldBounds } from "../terrain/terrain_surface.js";

export const Y_CELLS = 128;
export const MESH_PARAM_WORDS = 24;
export const FIELD_PARAM_WORDS = 16;
export const DIG_EDIT_WORDS = 10;
export const DIG_EDIT_BYTES = DIG_EDIT_WORDS * 4;

export interface MeshDims {
  x0: number; x1: number; z0: number; z1: number;
  vxBase: number; vyBase: number; vzBase: number;
  vxCount: number; vyCount: number; vzCount: number;
  slotCount: number;
  maxVertices: number;
  maxIndices: number;
}

export interface MeshBufferOffsets {
  positionBaseF32?: number;
  normalBaseF32?: number;
  materialBaseF32?: number;
  cellIndexBase?: number;
  indexBase?: number;
  counterSlot?: number;
}

export function computeMeshDims(cx: number, cz: number, S: number, vyBase = -1): MeshDims {
  const x0 = cx * S, x1 = (cx + 1) * S;
  const z0 = cz * S, z1 = (cz + 1) * S;
  const vxBase = x0 - 1, vzBase = z0 - 1;
  const vxCount = S + 1, vyCount = Y_CELLS + 1, vzCount = S + 1;
  const slotCount = vxCount * vyCount * vzCount;
  const edgeCount = S * S * Y_CELLS * 3;
  return {
    x0, x1, z0, z1,
    vxBase, vyBase, vzBase,
    vxCount, vyCount, vzCount,
    slotCount,
    maxVertices: slotCount,
    maxIndices: edgeCount * 6,
  };
}

export function packMeshParams(
  dims: MeshDims,
  world: WorldBounds,
  offsets: MeshBufferOffsets = {},
): Int32Array {
  const p = new Int32Array(MESH_PARAM_WORDS);
  p[0] = dims.x0; p[1] = dims.x1;
  p[2] = dims.z0; p[3] = dims.z1;
  p[4] = Y_CELLS;
  p[5] = world.cellsX; p[6] = world.cellsZ;
  p[7] = dims.vxBase; p[8] = dims.vyBase; p[9] = dims.vzBase;
  p[10] = dims.vxCount; p[11] = dims.vyCount; p[12] = dims.vzCount;
  p[13] = dims.maxIndices;
  p[14] = dims.maxVertices;
  p[15] = world.finite === false ? 0 : 1;
  p[16] = Math.max(0, Math.floor(offsets.positionBaseF32 ?? 0));
  p[17] = Math.max(0, Math.floor(offsets.normalBaseF32 ?? 0));
  p[18] = Math.max(0, Math.floor(offsets.materialBaseF32 ?? 0));
  p[19] = Math.max(0, Math.floor(offsets.cellIndexBase ?? 0));
  p[20] = Math.max(0, Math.floor(offsets.indexBase ?? 0));
  p[21] = Math.max(0, Math.floor(offsets.counterSlot ?? 0));
  return p;
}

export function packFieldParams(
  editCount: number,
  config: TerrainFieldConfig = getTerrainFieldCoreConfig(),
): Uint32Array {
  const p = new Uint32Array(FIELD_PARAM_WORDS);
  const i = new Int32Array(p.buffer);
  const f = new Float32Array(p.buffer);
  p[0] = editCount >>> 0;
  i[1] = config.seed | 0;
  p[2] = config.islandShape.enabled ? 1 : 0;
  p[3] = config.islandShape.oceanRim ? 1 : 0;
  f[4] = config.seaLevel;
  f[5] = config.islandShape.spacingM;
  f[6] = config.islandShape.radiusM;
  f[7] = config.islandShape.blendM;
  f[8] = config.islandShape.warpStrengthM;
  f[9] = config.islandShape.beachWidthM;
  f[10] = config.islandShape.cliffWidthM;
  f[11] = config.islandShape.worldRadiusM;
  f[12] = config.islandShape.oceanRimDropM;
  return p;
}

export function packDigEdits(edits: readonly ResolvedDigEdit[]): ArrayBuffer {
  const count = Math.max(1, edits.length);
  const buf = new ArrayBuffer(count * DIG_EDIT_BYTES);
  const f = new Float32Array(buf);
  const i = new Int32Array(buf);
  for (let e = 0; e < edits.length; e++) {
    const o = e * DIG_EDIT_WORDS;
    const d = edits[e];
    f[o + 0] = d.x; f[o + 1] = d.y; f[o + 2] = d.z; f[o + 3] = d.r; f[o + 4] = d.h;
    i[o + 5] = d.shape; i[o + 6] = d.opAdd;
    f[o + 7] = d.strength; f[o + 8] = d.falloff;
    i[o + 9] = d.material;
  }
  return buf;
}

export function assembleChunkMesh(
  positions: Float32Array,
  normals: Float32Array,
  materials: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  indexCount: number,
): { positions: Float32Array; normals: Float32Array; materials: Float32Array; indices: Uint32Array } {
  return {
    positions: positions.slice(0, vertexCount * 3),
    normals: normals.slice(0, vertexCount * 3),
    materials: materials.slice(0, vertexCount),
    indices: indices.slice(0, indexCount),
  };
}
