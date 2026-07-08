import { describe, expect, it } from "vitest";
import type { PageMesh } from "../types.js";
import { weldVertices } from "./weld.js";

describe("weldVertices", () => {
  it("merges duplicate quantized positions without string-key allocation semantics leaking", () => {
    const mesh: PageMesh = {
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 0, 0,
      ]),
      normals: new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      ]),
      paintSlots: new Float32Array([0, 0, 0]),
      materialWeights: new Float32Array(12),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 1, 2]),
    };

    const result = weldVertices(mesh, 0.001);

    expect(result.report.inputVertices).toBe(3);
    expect(result.report.outputVertices).toBe(2);
    expect([...result.mesh.indices]).toEqual([0, 1, 0]);
  });

  it("welds coincident vertices that straddle a quantization bucket boundary", () => {
    // 0.0004 and 0.0006 are 0.0002 apart — far within epsilon 0.001 — yet round to buckets 0 and 1.
    // A single-bucket snap would leave them unwelded (the streamed-root internal-seam failure at
    // large world coordinates, where f32 noise pushes a shared seam vertex across a bucket edge).
    const mesh: PageMesh = {
      positions: new Float32Array([
        0.0004, 0, 0,
        1, 0, 0,
        0.0006, 0, 0,
      ]),
      normals: new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      ]),
      paintSlots: new Float32Array([0, 0, 0]),
      materialWeights: new Float32Array(12),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 1, 2]),
    };

    const result = weldVertices(mesh, 0.001);

    expect(result.report.outputVertices).toBe(2);
    expect([...result.mesh.indices]).toEqual([0, 1, 0]);
  });

  it("does not over-merge distinct vertices in an adjacent bucket beyond epsilon", () => {
    // 0 and 0.0012 fall in adjacent buckets (0 and 1) but are 0.0012 apart, > epsilon 0.001, so the
    // true-distance check must keep them distinct even though the neighbour bucket is searched.
    const mesh: PageMesh = {
      positions: new Float32Array([
        0, 0, 0,
        0.0012, 0, 0,
      ]),
      normals: new Float32Array([
        0, 1, 0,
        0, 1, 0,
      ]),
      paintSlots: new Float32Array([0, 0]),
      materialWeights: new Float32Array(8),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 1, 0]),
    };

    const result = weldVertices(mesh, 0.001);

    expect(result.report.outputVertices).toBe(2);
  });
});
