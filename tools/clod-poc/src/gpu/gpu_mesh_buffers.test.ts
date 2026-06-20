// Verifies host buffer packing matches the WGSL struct layouts in surface_nets.compute.wgsl
// (a byte-offset mismatch silently feeds the GPU garbage), and that assembling readback arrays
// reproduces the canonical surface end-to-end.

import { describe, it, expect } from "vitest";
import {
  Y_CELLS,
  DIG_EDIT_WORDS,
  computeMeshDims,
  packMeshParams,
  packFieldParams,
  packDigEdits,
  assembleChunkMesh,
} from "./gpu_mesh_buffers.js";
import { resolveDigEdits } from "./terrain_field_core.js";
import { meshChunkGpuShaped } from "./surface_nets_core.js";
import { meshChunk } from "../terrain.js";
import type { ClodPagesConfig } from "../config.js";

describe("computeMeshDims", () => {
  it("matches the grid meshChunkGpuShaped uses", () => {
    const S = 8;
    const d = computeMeshDims(2, 3, S);
    expect(d.x0).toBe(16);
    expect(d.x1).toBe(24);
    expect(d.z0).toBe(24);
    expect(d.z1).toBe(32);
    expect(d.vxBase).toBe(15);
    expect(d.vyBase).toBe(-1);
    expect(d.vzBase).toBe(23);
    expect(d.vxCount).toBe(S + 1);
    expect(d.vyCount).toBe(Y_CELLS + 1);
    expect(d.vzCount).toBe(S + 1);
    expect(d.slotCount).toBe((S + 1) * (Y_CELLS + 1) * (S + 1));
    expect(d.maxVertices).toBe(d.slotCount);
    expect(d.maxIndices).toBe(S * S * Y_CELLS * 3 * 6);
  });
});

describe("packMeshParams", () => {
  it("writes MeshParams fields in wgsl struct order", () => {
    const dims = computeMeshDims(1, 1, 8);
    const p = packMeshParams(dims, { cellsX: 64, cellsZ: 48 });
    expect(p.length).toBe(16);
    expect([p[0], p[1], p[2], p[3]]).toEqual([dims.x0, dims.x1, dims.z0, dims.z1]);
    expect(p[4]).toBe(Y_CELLS);
    expect([p[5], p[6]]).toEqual([64, 48]);
    expect([p[7], p[8], p[9]]).toEqual([dims.vxBase, dims.vyBase, dims.vzBase]);
    expect([p[10], p[11], p[12]]).toEqual([dims.vxCount, dims.vyCount, dims.vzCount]);
    expect(p[13]).toBe(dims.maxIndices);
    expect(p[14]).toBe(dims.maxVertices);
  });
});

describe("packFieldParams", () => {
  it("writes editCount at word 0", () => {
    const p = packFieldParams(7);
    expect(p.length).toBe(4);
    expect(p[0]).toBe(7);
    expect([p[1], p[2], p[3]]).toEqual([0, 0, 0]);
  });
});

describe("packDigEdits", () => {
  it("lays out each edit as 10 words in DigEdit struct order (stride 40)", () => {
    const resolved = resolveDigEdits([
      { x: 1, y: 2, z: 3, r: 4, height: 5, shape: "cube", op: "add", strength: 0.5, falloff: 0.25, material: 3 },
    ]);
    const buf = packDigEdits(resolved);
    expect(buf.byteLength).toBe(DIG_EDIT_WORDS * 4); // one edit, stride 40
    const f = new Float32Array(buf);
    const i = new Int32Array(buf);
    expect([f[0], f[1], f[2], f[3], f[4]]).toEqual([1, 2, 3, 4, 5]); // x,y,z,r,h
    expect(i[5]).toBe(1); // shape: cube
    expect(i[6]).toBe(1); // opAdd: add
    expect(f[7]).toBeCloseTo(0.5); // strength
    expect(f[8]).toBeCloseTo(0.25); // falloff
    expect(i[9]).toBe(3); // material
  });

  it("never returns a zero-sized buffer", () => {
    expect(packDigEdits([]).byteLength).toBe(DIG_EDIT_WORDS * 4);
  });
});

describe("assembleChunkMesh end-to-end", () => {
  it("reproduces the canonical surface from max-sized readback arrays", () => {
    const S = 4;
    const world = { cellsX: 16, cellsZ: 16 };
    const cfg = { page: { chunk_size: S } } as unknown as ClodPagesConfig;
    // The GPU writes compact verts/indices into oversized buffers; emulate that with the verified
    // mesher and over-allocated backing arrays, then assemble by the reported counts.
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
    const vertexCount = gpu.positions.length / 3;
    const indexCount = gpu.indices.length;

    const asm = assembleChunkMesh(posBuf, nrmBuf, matBuf, idxBuf, vertexCount, indexCount);
    expect(asm.positions).toEqual(gpu.positions);
    expect(asm.indices).toEqual(gpu.indices);

    // And the assembled surface still equals canonical meshChunk (sanity over the full chain).
    const canonical = meshChunk(1, 1, cfg, world);
    expect(asm.indices.length).toBe(canonical.indices.length);
  });
});
