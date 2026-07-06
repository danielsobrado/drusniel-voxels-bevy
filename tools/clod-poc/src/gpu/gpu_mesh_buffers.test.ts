import { describe, it, expect, beforeEach } from "vitest";
import { voxelEditStore } from "../terrain/voxel_edits/voxel_edit_store.js";
import { Y_CELLS, DIG_EDIT_WORDS, MESH_PARAM_WORDS, computeMeshDims, packMeshParams, packFieldParams, packDigEdits, assembleChunkMesh } from "./gpu_mesh_buffers.js";
import { resolveDigEdits } from "./terrain_field_core.js";
import { meshChunkGpuShaped } from "./surface_nets_core.js";
import { meshChunk } from "../terrain/terrain.js";
import type { ClodPagesConfig } from "../config.js";

describe("computeMeshDims", () => {
  it("matches the grid meshChunkGpuShaped uses", () => {
    const S = 8;
    const d = computeMeshDims(2, 3, S);
    expect([d.x0, d.x1, d.z0, d.z1]).toEqual([16, 24, 24, 32]);
    expect([d.vxBase, d.vyBase, d.vzBase]).toEqual([15, -1, 23]);
    expect([d.vxCount, d.vyCount, d.vzCount]).toEqual([S + 1, Y_CELLS + 1, S + 1]);
    expect(d.slotCount).toBe((S + 1) * (Y_CELLS + 1) * (S + 1));
    expect(d.maxVertices).toBe(d.slotCount);
    expect(d.maxIndices).toBe(S * S * Y_CELLS * 3 * 6);
  });
});

describe("packMeshParams", () => {
  it("writes MeshParams fields in wgsl struct order", () => {
    const dims = computeMeshDims(1, 1, 8);
    const p = packMeshParams(dims, { cellsX: 64, cellsZ: 48 }, { positionBaseF32: 10, normalBaseF32: 20, materialBaseF32: 30, cellIndexBase: 40, indexBase: 50, counterSlot: 3 });
    expect(p.length).toBe(MESH_PARAM_WORDS);
    expect([p[0], p[1], p[2], p[3]]).toEqual([dims.x0, dims.x1, dims.z0, dims.z1]);
    expect(p[4]).toBe(Y_CELLS);
    expect([p[5], p[6]]).toEqual([64, 48]);
    expect([p[7], p[8], p[9]]).toEqual([dims.vxBase, dims.vyBase, dims.vzBase]);
    expect([p[10], p[11], p[12]]).toEqual([dims.vxCount, dims.vyCount, dims.vzCount]);
    expect([p[13], p[14], p[15]]).toEqual([dims.maxIndices, dims.maxVertices, 1]);
    expect([p[16], p[17], p[18], p[19], p[20], p[21]]).toEqual([10, 20, 30, 40, 50, 3]);
  });

  it("packs finite false", () => {
    const p = packMeshParams(computeMeshDims(64, 64, 8), { cellsX: 64, cellsZ: 64, finite: false });
    expect(p[15]).toBe(0);
  });
});

describe("packFieldParams", () => {
  it("writes editCount and terrain config in wgsl struct order", () => {
    const p = packFieldParams(7);
    expect(p.length).toBe(16);
    expect(p[0]).toBe(7);
  });
});

describe("packDigEdits", () => {
  it("packs one resolved edit", () => {
    const resolved = resolveDigEdits([{ x: 1, y: 2, z: 3, r: 4, height: 5, shape: "sphere", op: "add", strength: 0.5, falloff: 0.25, material: 3 }]);
    const buf = packDigEdits(resolved);
    expect(buf.byteLength).toBe(DIG_EDIT_WORDS * 4);
    expect(new Float32Array(buf)[0]).toBe(1);
  });

  it("never returns a zero-sized buffer", () => {
    expect(packDigEdits([]).byteLength).toBe(DIG_EDIT_WORDS * 4);
  });
});

describe("assembleChunkMesh end-to-end", () => {
  beforeEach(() => { voxelEditStore.clear(); });

  it("reproduces the canonical surface from max-sized readback arrays", () => {
    const S = 4;
    const world = { cellsX: 16, cellsZ: 16 };
    const cfg = { page: { chunk_size: S }, simplify: { weld_epsilon_cells: 0.3 } } as unknown as ClodPagesConfig;
    const gpu = meshChunkGpuShaped(1, 1, S, world, []);
    const dims = computeMeshDims(1, 1, S);
    const posBuf = new Float32Array(dims.maxVertices * 3);
    const nrmBuf = new Float32Array(dims.maxVertices * 3);
    const matBuf = new Float32Array(dims.maxVertices);
    const idxBuf = new Uint32Array(dims.maxIndices);
    posBuf.set(gpu.positions);
    nrmBuf.set(gpu.normals);
    matBuf.set(gpu.materials);
    idxBuf.set(gpu.indices);
    const asm = assembleChunkMesh(posBuf, nrmBuf, matBuf, idxBuf, gpu.positions.length / 3, gpu.indices.length);
    expect(asm.positions).toEqual(gpu.positions);
    expect(asm.indices).toEqual(gpu.indices);
    expect(asm.indices.length).toBe(meshChunk(1, 1, cfg, world).indices.length);
  });
});
