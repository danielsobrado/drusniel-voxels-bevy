// Pure host-side buffer math + packing for the GPU Surface Nets mesher. Split out from the GPU
// driver (gpu_chunk_mesher.ts) so the byte layouts — which must match the WGSL structs in
// shaders/terrain_field_entry.wgsl exactly or the GPU reads garbage — are unit-testable headless
// (gpu_mesh_buffers.test.ts). No WebGPU here.

import { ResolvedDigEdit } from "./terrain_field_core.js";

// Mirror of terrain.ts Y_CELLS / the wgsl yCells.
export const Y_CELLS = 128;

// WGSL struct sizes (4-byte words).
export const MESH_PARAM_WORDS = 16; // MeshParams: 13 dims + maxIndices + maxVertices + pad
export const FIELD_PARAM_WORDS = 4; // FieldParams: editCount + 3 pad
export const DIG_EDIT_WORDS = 10; // DigEdit: x,y,z,r,h,shape,opAdd,strength,falloff,material
export const DIG_EDIT_BYTES = DIG_EDIT_WORDS * 4; // stride 40

/** Geometry/buffer dimensions for meshing one chunk. Mirrors meshChunkGpuShaped's grid. */
export interface MeshDims {
  x0: number; x1: number; z0: number; z1: number;
  vxBase: number; vyBase: number; vzBase: number;
  vxCount: number; vyCount: number; vzCount: number;
  slotCount: number; // grid cells = max possible vertices
  maxVertices: number;
  maxIndices: number;
}

export function computeMeshDims(cx: number, cz: number, S: number): MeshDims {
  const x0 = cx * S, x1 = (cx + 1) * S;
  const z0 = cz * S, z1 = (cz + 1) * S;
  const vxBase = x0 - 1, vyBase = -1, vzBase = z0 - 1;
  const vxCount = S + 1, vyCount = Y_CELLS + 1, vzCount = S + 1;
  const slotCount = vxCount * vyCount * vzCount;
  // Worst case: every cell holds a vertex; every axis-edge in the chunk crosses (6 indices each).
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

/** Pack MeshParams (binding 2). Int32Array view is bit-compatible with the u32 fields. */
export function packMeshParams(
  dims: MeshDims,
  world: { cellsX: number; cellsZ: number },
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
  p[15] = 0; // pad
  return p;
}

/** Pack FieldParams (binding 1): editCount + padding. */
export function packFieldParams(editCount: number): Uint32Array {
  const p = new Uint32Array(FIELD_PARAM_WORDS);
  p[0] = editCount >>> 0;
  return p;
}

/** Pack resolved dig edits into the binding-0 storage layout (stride 40, fields in struct order).
 *  Returns at least one element's worth so the buffer is never zero-sized. */
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

/** Slice the (max-sized, reused) readback arrays to the live counts the GPU reported. */
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
