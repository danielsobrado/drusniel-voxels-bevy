import { describe, expect, it } from "vitest";
import { interpolateMeshHeightAt } from "./mesh_height_probe.js";

// Two triangles forming the unit quad [0,1]x[0,1] with a height gradient in x.
const quad = {
  positions: new Float32Array([
    0, 0, 0,
    1, 4, 0,
    1, 4, 1,
    0, 0, 1,
  ]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
};

describe("interpolateMeshHeightAt", () => {
  it("interpolates heights inside triangles", () => {
    expect(interpolateMeshHeightAt(quad, 0.5, 0.5)).toBeCloseTo(2, 5);
    expect(interpolateMeshHeightAt(quad, 0.25, 0.75)).toBeCloseTo(1, 5);
  });

  it("returns null outside the mesh footprint", () => {
    expect(interpolateMeshHeightAt(quad, 2.5, 0.5)).toBeNull();
    expect(interpolateMeshHeightAt(quad, -0.5, -0.5)).toBeNull();
  });

  it("reports the top surface when triangles overlap in XZ", () => {
    const overhang = {
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 0, 1,
        0, 10, 0,
        1, 10, 0,
        1, 10, 1,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    expect(interpolateMeshHeightAt(overhang, 0.75, 0.25)).toBeCloseTo(10, 5);
  });

  it("skips triangles that are vertical walls in XZ", () => {
    const wall = {
      positions: new Float32Array([
        0, 0, 0,
        0, 5, 0,
        0, 5, 1,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    };
    expect(interpolateMeshHeightAt(wall, 0, 0.5)).toBeNull();
  });
});
