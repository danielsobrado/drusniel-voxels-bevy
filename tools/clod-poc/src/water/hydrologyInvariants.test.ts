import { describe, expect, it } from "vitest";
import {
  createHydrologyGrid,
  gridIndex,
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
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

describe("hydrology invariants", () => {
  it("passes for a flat lake above its bed", () => {
    const grid = lakeGrid(5, () => 10);
    const check = checkHydrologyInvariants(grid);
    expect(check.passed).toBe(true);
    expect(check.report.lakeFlatnessMaxDeviation).toBeCloseTo(0, 6);
    expect(check.report.wetWithoutBodyIdCount).toBe(0);
  });

  it("flags a tilted lake as a flatness violation", () => {
    const grid = lakeGrid(5, (x) => 10 + x); // surface slopes across the body
    const report = evaluateHydrologyInvariants(grid);
    expect(report.lakeFlatnessMaxDeviation).toBeGreaterThan(0.5);
    expect(checkHydrologyInvariants(grid).passed).toBe(false);
  });

  it("flags dry cells that carry water above the bed", () => {
    const grid = lakeGrid(5, () => 10);
    // Poison a dry cell with a water surface above its bed.
    const i = gridIndex(5, 0, 0);
    grid.carvedBed[i] = 0;
    grid.waterY[i] = 5; // dry (wetMask 0) but above bed
    const report = evaluateHydrologyInvariants(grid);
    expect(report.dryWithWaterCount).toBeGreaterThan(0);
  });
});
