import { describe, expect, it } from "vitest";
import {
  createHydrologyGrid,
  gridIndex,
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_RIVER,
  type HydrologyAuthority,
  type HydrologyGrid,
} from "./hydrologyGrid.js";
import { computeBodyIds } from "./bodyIdentity.js";
import { checkHydrologyInvariants, evaluateHydrologyInvariants } from "./hydrologyInvariants.js";

function lakeGrid(res: number, surfaceOf: (x: number, z: number) => number): HydrologyGrid {
  const grid = createHydrologyGrid(res, res - 1, { surfaceHeight: () => 0 });
  grid.wetMask.fill(0);
  grid.bodyKind.fill(HYDROLOGY_BODY_DRY);
  grid.carvedBed.fill(0);
  grid.waterY.fill(-100);
  for (let z = 1; z < res - 1; z++) {
    for (let x = 1; x < res - 1; x++) {
      const i = gridIndex(res, x, z);
      grid.wetMask[i] = 1;
      grid.bodyKind[i] = HYDROLOGY_BODY_LAKE;
      grid.lakeMask[i] = 1;
      grid.carvedBed[i] = 2;
      grid.waterY[i] = surfaceOf(x, z);
    }
  }
  computeBodyIds(grid);
  return grid;
}

function riverStepGrid(authority: HydrologyAuthority): HydrologyGrid {
  const grid = createHydrologyGrid(3, 2, { surfaceHeight: () => 0 }, 1, authority);
  grid.waterY.fill(-1);
  const upstream = gridIndex(3, 0, 1);
  const downstream = gridIndex(3, 1, 1);
  for (const index of [upstream, downstream]) {
    grid.wetMask[index] = 1;
    grid.riverMask[index] = 1;
    grid.bodyKind[index] = HYDROLOGY_BODY_RIVER;
    grid.bodyId[index] = 7;
  }
  grid.waterY[upstream] = 1;
  grid.waterY[downstream] = 1.2;
  grid.flowDirX[downstream] = 1;
  return grid;
}

describe("hydrology invariants", () => {
  it("passes for a flat lake above its bed", () => {
    const grid = lakeGrid(5, () => 10);
    const check = checkHydrologyInvariants(grid);
    expect(check.passed).toBe(true);
    expect(check.report.lakeFlatnessMaxDeviation).toBeCloseTo(0, 6);
    expect(check.report.wetWithoutBodyIdCount).toBe(0);
  });

  it("flags a tilted lake as a flatness violation", () => {
    const grid = lakeGrid(5, (x) => 10 + x);
    const report = evaluateHydrologyInvariants(grid);
    expect(report.lakeFlatnessMaxDeviation).toBeGreaterThan(0.5);
    expect(checkHydrologyInvariants(grid).passed).toBe(false);
  });

  it("flags dry cells that carry water above the bed", () => {
    const grid = lakeGrid(5, () => 10);
    const i = gridIndex(5, 0, 0);
    grid.carvedBed[i] = 0;
    grid.waterY[i] = 5;
    const report = evaluateHydrologyInvariants(grid);
    expect(report.dryWithWaterCount).toBeGreaterThan(0);
  });

  it("uses the grid authority instead of carved-bed heuristics", () => {
    const finite = riverStepGrid("finite_grid");
    const unified = riverStepGrid("unified_traced");

    expect(finite.carvedBed[0]).toBe(finite.originalBed[0]);
    expect(finite.carvedBed[finite.carvedBed.length - 1]).toBe(finite.originalBed[finite.originalBed.length - 1]);
    expect(checkHydrologyInvariants(finite).passed).toBe(false);
    expect(checkHydrologyInvariants(unified).passed).toBe(true);
  });
});
