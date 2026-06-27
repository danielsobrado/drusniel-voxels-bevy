// Pins the GPU-shaped mesher to canonical terrain.ts meshChunk by SURFACE equality: the two
// must emit the same triangle set (identical vertex positions + connectivity), even though the
// GPU-shaped mesher uses a dense full-Y scan and different vertex ordering. If this passes, the
// WGSL compute pass (a transliteration of surface_nets_core) has a verified logic spec.

import { describe, it, expect, afterEach } from "vitest";
import { meshChunk, replaceDigEdits, clearDigEdits, DigEdit } from "../terrain/terrain.js";
import type { ClodPagesConfig } from "../config.js";
import type { PageMesh } from "../types.js";
import { meshChunkGpuShaped, ChunkMeshArrays } from "./surface_nets_core.js";
import { resolveDigEdits } from "./terrain_field_core.js";

const S = 4;
const WORLD = { cellsX: 16, cellsZ: 16 };
const cfg = {
  page: { chunk_size: S },
  simplify: { weld_epsilon_cells: 0.3 },
} as unknown as ClodPagesConfig;

afterEach(() => clearDigEdits());

/** A triangle as its 3 vertex positions, canonicalised orientation-independently so the set
 *  compares geometry regardless of winding or vertex ordering between the two meshers. */
function vertexKey(positions: Float32Array, vi: number): string {
  return `${positions[vi * 3]},${positions[vi * 3 + 1]},${positions[vi * 3 + 2]}`;
}

function triangleMultiset(mesh: PageMesh | ChunkMeshArrays): string[] {
  const out: string[] = [];
  const { indices, positions } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const keys = [
      vertexKey(positions, indices[t]),
      vertexKey(positions, indices[t + 1]),
      vertexKey(positions, indices[t + 2]),
    ].sort();
    out.push(keys.join("|"));
  }
  return out.sort();
}

function uniqueVertexSet(mesh: PageMesh | ChunkMeshArrays): Set<string> {
  const s = new Set<string>();
  for (let vi = 0; vi < mesh.positions.length / 3; vi++) s.add(vertexKey(mesh.positions, vi));
  return s;
}

function expectSameSurface(a: PageMesh, b: ChunkMeshArrays) {
  // The rendered surface must be identical: same triangles (positions + connectivity), winding
  // and vertex order aside.
  expect(triangleMultiset(b)).toEqual(triangleMultiset(a));
  // The GPU-shaped mesher uses a dense grid, so it may carry a few unreferenced halo vertices the
  // on-demand CPU mesher never allocates (harmless unused slots). It must not be MISSING any used
  // vertex, so canonical ⊆ gpu.
  const gpuVerts = uniqueVertexSet(b);
  for (const v of uniqueVertexSet(a)) expect(gpuVerts.has(v)).toBe(true);
}

describe("surface_nets_core surface parity (no edits)", () => {
  // (0,0) and (3,3) touch the world perimeter (exercises quad clipping); (1,1) is interior.
  for (const [cx, cz] of [[0, 0], [1, 1], [3, 3]] as const) {
    it(`chunk (${cx},${cz}) matches canonical meshChunk surface`, () => {
      const canonical = meshChunk(cx, cz, cfg, WORLD);
      const gpu = meshChunkGpuShaped(cx, cz, S, WORLD, []);
      expect(gpu.indices.length).toBeGreaterThan(0);
      expectSameSurface(canonical, gpu);
    });
  }
});

describe("surface_nets_core surface parity (with edits)", () => {
  const edits: DigEdit[] = [
    { x: 6, y: 28, z: 6, r: 5 }, // sphere remove, carves into chunk (1,1)
    { x: 5, y: 30, z: 5, r: 4, shape: "cube", op: "add", material: 2 },
    { x: 10, y: 26, z: 9, r: 4, shape: "cylinder", op: "remove", height: 6 },
  ];

  it("chunk (1,1) matches canonical meshChunk surface under a mixed edit history", () => {
    replaceDigEdits(edits);
    const resolved = resolveDigEdits(edits);
    const canonical = meshChunk(1, 1, cfg, WORLD);
    const gpu = meshChunkGpuShaped(1, 1, S, WORLD, resolved);
    expectSameSurface(canonical, gpu);
  });
});
