// Tests the tolerance comparator used by the in-browser GPU parity harness, driven by the
// verified CPU mesher with synthetic f32-style perturbation standing in for the GPU's f32 drift.

import { describe, it, expect } from "vitest";
import { meshChunk } from "../terrain/terrain.js";
import type { ClodPagesConfig } from "../config.js";
import { meshChunkGpuShaped } from "./surface_nets_core.js";
import { compareChunkSurfaces } from "./gpu_mesh_parity.js";

const S = 4;
const world = { cellsX: 16, cellsZ: 16 };
const cfg = {
  page: { chunk_size: S },
  simplify: { weld_epsilon_cells: 0.3 },
} as unknown as ClodPagesConfig;

function perturb(positions: Float32Array, amount: number): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    // Deterministic small shift, bounded by `amount`.
    out[i] = positions[i] + Math.sin(i * 12.9898) * amount;
  }
  return out;
}

describe("compareChunkSurfaces", () => {
  const base = meshChunkGpuShaped(1, 1, S, world, []);

  it("reports zero delta and full match for an identical surface", () => {
    const cmp = compareChunkSurfaces(base, base, 1e-3);
    expect(cmp.cpuVertices).toBe(cmp.gpuVertices);
    expect(cmp.cpuTriangles).toBe(cmp.gpuTriangles);
    expect(cmp.maxVertexDelta).toBe(0);
    expect(cmp.unmatched).toBe(0);
    expect(cmp.haloVertices).toBe(0);
    expect(cmp.withinTol).toBe(true);
  });

  it("treats the GPU dense-grid halo vertices as a match, not drift (canonical ⊆ gpu)", () => {
    // Reproduces the live harness comparison: the dense GPU-shaped mesher carries unreferenced halo
    // vertices that the on-demand canonical mesher never allocates. Surface is identical, so every
    // canonical vertex must match and the extra GPU vertices must NOT be flagged as drift.
    for (const [cx, cz] of [[0, 0], [1, 1], [3, 3]] as const) {
      const canonical = meshChunk(cx, cz, cfg, world);
      const gpu = meshChunkGpuShaped(cx, cz, S, world, []);
      const cmp = compareChunkSurfaces(canonical, gpu, 0.05);
      expect(cmp.gpuVertices).toBeGreaterThanOrEqual(cmp.cpuVertices);
      expect(cmp.haloVertices).toBe(cmp.gpuVertices - cmp.cpuVertices);
      expect(cmp.unmatched).toBe(0);
      expect(cmp.withinTol).toBe(true);
    }
  });

  it("flags a used vertex the GPU is missing (the case GPU→CPU matching would hide)", () => {
    // Drop the second half of the GPU vertices so several referenced canonical vertices have no GPU
    // counterpart. Iterating CPU → GPU catches this; iterating GPU → CPU would not.
    const keep = Math.floor(base.positions.length / 6) * 3;
    const gpu = { positions: base.positions.slice(0, keep), indices: base.indices };
    const cmp = compareChunkSurfaces(base, gpu, 1e-6);
    expect(cmp.unmatched).toBeGreaterThan(0);
    expect(cmp.withinTol).toBe(false);
  });

  it("matches a slightly perturbed surface within tolerance and reports the drift", () => {
    const drift = 5e-4;
    const gpu = { positions: perturb(base.positions, drift), indices: base.indices };
    const cmp = compareChunkSurfaces(base, gpu, 1e-2);
    expect(cmp.unmatched).toBe(0);
    expect(cmp.withinTol).toBe(true);
    expect(cmp.maxVertexDelta).toBeGreaterThan(0);
    // Each of x/y/z is shifted by up to `drift`, so the vertex distance bound is drift*sqrt(3).
    expect(cmp.maxVertexDelta).toBeLessThanOrEqual(drift * Math.sqrt(3) + 1e-9);
  });

  it("flags vertices that drift beyond tolerance as unmatched", () => {
    const gpu = { positions: perturb(base.positions, 0.5), indices: base.indices };
    const cmp = compareChunkSurfaces(base, gpu, 1e-3);
    expect(cmp.unmatched).toBeGreaterThan(0);
    expect(cmp.withinTol).toBe(false);
  });
});
