import { describe, expect, it } from "vitest";
import {
  HYDROLOGY_BODY_RIVER,
  createHydrologyGrid,
} from "../water/hydrologyGrid.js";
import { packHydrologyData, packHydrologyFieldData } from "./hydrology_packing.js";

describe("hydrology packing", () => {
  it("packs Layout A and Layout B through their canonical helpers", () => {
    const grid = createHydrologyGrid(2, 16, { surfaceHeight: () => 4 });
    grid.waterY[0] = 6;
    grid.wetMask[0] = 1;
    grid.carvedBed[0] = 5.5;
    grid.shoreDistance[0] = 2.5;
    grid.flowDirX[0] = 0.3;
    grid.flowDirZ[0] = 0.4;
    grid.moisture[0] = 0.7;
    grid.bodyKind[0] = HYDROLOGY_BODY_RIVER;

    const layoutA = packHydrologyData({ grid });
    const layoutB = packHydrologyFieldData({ grid });

    expect(layoutA).toMatchObject({ res: 2, worldCells: 16 });
    expect(Array.from(layoutA.data.slice(0, 4))).toEqual([6, 1, 5.5, 2.5]);
    expect(layoutB).toMatchObject({ res: 2, worldCells: 16 });
    expect(layoutB.data[0]).toBeCloseTo(0.3);
    expect(layoutB.data[1]).toBeCloseTo(0.4);
    expect(layoutB.data[2]).toBeCloseTo(0.7);
    expect(layoutB.data[3]).toBeCloseTo(HYDROLOGY_BODY_RIVER / 255);
  });
});
