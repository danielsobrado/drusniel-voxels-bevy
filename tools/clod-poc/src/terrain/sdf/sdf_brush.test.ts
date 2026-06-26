import { describe, expect, it } from "vitest";
import { applyBrushSdfToDensity, sampleBrushSdf, type SdfBrush } from "./sdf_brush.js";

function brush(overrides: Partial<SdfBrush> = {}): SdfBrush {
  return {
    x: 0,
    y: 0,
    z: 0,
    radius: 4,
    height: 4,
    shape: "sphere",
    op: "remove",
    strength: 1,
    falloff: 0,
    ...overrides,
  };
}

describe("SDF brush", () => {
  it("samples analytic brush shapes with negative inside and zero at the boundary", () => {
    expect(sampleBrushSdf("sphere", 0, 0, 0, 4, 4)).toBeCloseTo(-4, 6);
    expect(sampleBrushSdf("sphere", 4, 0, 0, 4, 4)).toBeCloseTo(0, 6);
    expect(sampleBrushSdf("cube", 0, 0, 0, 4, 4)).toBeCloseTo(-4, 6);
    expect(sampleBrushSdf("cylinder", 4, 0, 0, 4, 4)).toBeCloseTo(0, 6);
  });

  it("removes density inside the brush", () => {
    const after = applyBrushSdfToDensity(brush({ op: "remove" }), 0, 0, 0, 8);

    expect(after).toBeCloseTo(-4, 6);
  });

  it("adds density inside the brush", () => {
    const after = applyBrushSdfToDensity(brush({ op: "add" }), 0, 0, 0, -8);

    expect(after).toBeCloseTo(4, 6);
  });

  it("keeps hard-brush boundary samples active", () => {
    const after = applyBrushSdfToDensity(brush({ op: "add", falloff: 0 }), 4, 0, 0, -2);

    expect(after).toBeCloseTo(0, 6);
  });

  it("attenuates soft brushes by falloff and strength", () => {
    const after = applyBrushSdfToDensity(brush({ op: "add", falloff: 0.5, strength: 0.5 }), 2, 0, 0, -4);

    expect(after).toBeCloseTo(-1, 6);
  });
});
