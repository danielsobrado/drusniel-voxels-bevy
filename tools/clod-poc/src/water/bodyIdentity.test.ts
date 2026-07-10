import { describe, expect, it } from "vitest";
import {
  createHydrologyGrid,
  gridIndex,
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_RIVER,
  type HydrologyGrid,
} from "./hydrologyGrid.js";
import { computeBodyIds, computeShoreDistance } from "./bodyIdentity.js";

function emptyGrid(res: number): HydrologyGrid {
  // Flat terrain; we overwrite the fields we care about directly.
  const grid = createHydrologyGrid(res, res - 1, { surfaceHeight: () => 0 });
  grid.wetMask.fill(0);
  grid.bodyKind.fill(HYDROLOGY_BODY_DRY);
  return grid;
}

function setWet(grid: HydrologyGrid, x: number, z: number, kind: number): void {
  const i = gridIndex(grid.res, x, z);
  grid.wetMask[i] = 1;
  grid.bodyKind[i] = kind;
}

describe("computeBodyIds", () => {
  it("assigns one id per connected same-class body and 0 to dry", () => {
    const grid = emptyGrid(4);
    // Body A: two adjacent lake cells.
    setWet(grid, 0, 0, HYDROLOGY_BODY_LAKE);
    setWet(grid, 1, 0, HYDROLOGY_BODY_LAKE);
    // Body B: a disjoint lake cell in the far corner.
    setWet(grid, 3, 3, HYDROLOGY_BODY_LAKE);
    computeBodyIds(grid);

    const a0 = grid.bodyId[gridIndex(4, 0, 0)];
    const a1 = grid.bodyId[gridIndex(4, 1, 0)];
    const b = grid.bodyId[gridIndex(4, 3, 3)];
    expect(a0).toBeGreaterThan(0);
    expect(a1).toBe(a0);
    expect(b).toBeGreaterThan(0);
    expect(b).not.toBe(a0);
    expect(grid.bodyId[gridIndex(4, 2, 2)]).toBe(0); // dry
  });

  it("does not connect a river cell to an adjacent lake cell (class gate)", () => {
    const grid = emptyGrid(4);
    setWet(grid, 0, 0, HYDROLOGY_BODY_LAKE);
    setWet(grid, 1, 0, HYDROLOGY_BODY_RIVER); // touches the lake but is flowing
    computeBodyIds(grid);
    const lake = grid.bodyId[gridIndex(4, 0, 0)];
    const river = grid.bodyId[gridIndex(4, 1, 0)];
    expect(lake).toBeGreaterThan(0);
    expect(river).toBeGreaterThan(0);
    expect(river).not.toBe(lake);
  });
});

describe("computeShoreDistance", () => {
  it("is 0 at the wet/dry boundary and grows toward the interior, in world metres", () => {
    const res = 7;
    const grid = createHydrologyGrid(res, res - 1, { surfaceHeight: () => 0 }); // texel = 1
    grid.wetMask.fill(0);
    // 5x5 block of water inset by one cell.
    for (let z = 1; z <= 5; z++) for (let x = 1; x <= 5; x++) grid.wetMask[gridIndex(res, x, z)] = 1;
    computeShoreDistance(grid);

    const edge = grid.shoreDistance[gridIndex(res, 1, 3)]; // wet cell touching dry
    const center = grid.shoreDistance[gridIndex(res, 3, 3)]; // deepest interior
    expect(edge).toBeCloseTo(0, 5);
    expect(center).toBeGreaterThan(edge);
    // texel = 1, so distances are already in metres; centre is ~2 cells from shore.
    expect(center).toBeGreaterThan(1.5);
  });
});
