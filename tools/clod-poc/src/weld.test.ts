import { describe, expect, it } from "vitest";
import type { PageMesh } from "./types.js";
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
});
