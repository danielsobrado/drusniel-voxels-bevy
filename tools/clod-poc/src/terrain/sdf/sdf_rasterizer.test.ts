import { describe, expect, it } from "vitest";
import { rasterizeSdfBrushToVoxelTransaction } from "./sdf_rasterizer.js";
import type { SdfBrush } from "./sdf_brush.js";

function brush(overrides: Partial<SdfBrush> = {}): SdfBrush {
  return {
    x: 0,
    y: 0,
    z: 0,
    radius: 1,
    height: 1,
    shape: "sphere",
    op: "add",
    strength: 1,
    falloff: 0,
    ...overrides,
  };
}

describe("SDF brush rasterizer", () => {
  it("rasterizes changed densities into a voxel transaction", () => {
    const transaction = rasterizeSdfBrushToVoxelTransaction({
      id: 11,
      revisionBase: 5,
      brush: brush(),
      bounds: { minX: -1, maxX: 1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      sampleDensity: () => -10,
    });

    expect(transaction.id).toBe(11);
    expect(transaction.revisionBase).toBe(5);
    expect(transaction.source).toBe("sdf-brush");
    expect(transaction.deltas).toEqual([
      { x: -1, y: 0, z: 0, density: 0, materialSlot: undefined },
      { x: 0, y: 0, z: 0, density: 1, materialSlot: undefined },
      { x: 1, y: 0, z: 0, density: 0, materialSlot: undefined },
    ]);
  });

  it("applies material slots only for additive brushes", () => {
    const add = rasterizeSdfBrushToVoxelTransaction({
      id: 1,
      revisionBase: 0,
      brush: brush({ op: "add", materialSlot: 3 }),
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      sampleDensity: () => 1,
    });
    const remove = rasterizeSdfBrushToVoxelTransaction({
      id: 2,
      revisionBase: 0,
      brush: brush({ op: "remove", materialSlot: 3 }),
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      sampleDensity: () => 1,
    });

    expect(add.deltas[0]!.materialSlot).toBe(3);
    expect(remove.deltas[0]!.materialSlot).toBeUndefined();
  });
});
