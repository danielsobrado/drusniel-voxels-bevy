import { describe, expect, it } from "vitest";
import { createHydrologyGrid, gridIndex, sampleHydrologyGrid, HYDROLOGY_BODY_LAKE } from "./hydrologyGrid.js";
import { computeBodyIds, computeShoreDistance } from "./bodyIdentity.js";
import { packHydrologyFieldsTexels, packHydrologyWaterSurfaceTexels } from "./hydrologyGpuPacking.js";
import { packHydrologyData } from "../systems/hydrology_packing.js";

function makeGrid(res = 8) {
  const worldCells = res - 1; // texel == 1 m
  const grid = createHydrologyGrid(res, worldCells, {
    surfaceHeight: (x: number, z: number) => 5 + Math.sin(x) + Math.cos(z),
  });
  // Small lake block with distinctive per-field values.
  for (let z = 2; z <= 4; z++) {
    for (let x = 2; x <= 4; x++) {
      const i = gridIndex(res, x, z);
      grid.wetMask[i] = 1;
      grid.waterY[i] = 12.5;
      grid.carvedBed[i] = 4.25;
      grid.bodyKind[i] = HYDROLOGY_BODY_LAKE;
      grid.moisture[i] = 0.75;
      grid.flowDirX[i] = 0.3;
      grid.flowDirZ[i] = -0.4;
    }
  }
  computeBodyIds(grid);
  computeShoreDistance(grid);
  return grid;
}

describe("canonical GPU packing", () => {
  it("Layout A texels mirror the grid fields exactly (waterY, wetMask, carvedBed, shoreDistance)", () => {
    const grid = makeGrid();
    const data = packHydrologyWaterSurfaceTexels(grid);
    for (const i of [0, gridIndex(8, 3, 3), gridIndex(8, 4, 2), 63]) {
      expect(data[i * 4]).toBe(grid.waterY[i]);
      expect(data[i * 4 + 1]).toBe(grid.wetMask[i]);
      expect(data[i * 4 + 2]).toBe(grid.carvedBed[i]);
      expect(data[i * 4 + 3]).toBe(grid.shoreDistance[i]); // no duplicated waterY in A
    }
  });

  it("Layout B texels carry flow direction, moisture and bodyKind", () => {
    const grid = makeGrid();
    const data = packHydrologyFieldsTexels(grid);
    const i = gridIndex(8, 3, 3);
    expect(data[i * 4]).toBeCloseTo(0.3, 6);
    expect(data[i * 4 + 1]).toBeCloseTo(-0.4, 6);
    expect(data[i * 4 + 2]).toBeCloseTo(0.75, 6);
    expect(data[i * 4 + 3]).toBeCloseTo(HYDROLOGY_BODY_LAKE / 255, 6);
  });

  it("GPU texels agree with the CPU sample at texel-aligned world coordinates", () => {
    const grid = makeGrid();
    const data = packHydrologyWaterSurfaceTexels(grid);
    // texel (x,z) <-> world (x,z) because worldCells = res-1.
    for (const [x, z] of [
      [3, 3],
      [2, 4],
      [6, 1],
    ] as const) {
      const cpu = sampleHydrologyGrid(grid, x, z);
      const i = gridIndex(8, x, z);
      expect(data[i * 4]).toBeCloseTo(cpu.waterY, 4);
      expect(data[i * 4 + 2]).toBeCloseTo(cpu.terrainY, 4); // carvedBed == canonical terrainY
      expect(data[i * 4 + 3]).toBeCloseTo(cpu.shoreDistance, 4);
    }
  });

  it("understory packing reuses the canonical Layout A", () => {
    const grid = makeGrid();
    const understory = packHydrologyData({ grid });
    expect(understory.res).toBe(grid.res);
    expect(understory.worldCells).toBe(grid.worldCells);
    expect(understory.data).toEqual(packHydrologyWaterSurfaceTexels(grid));
  });
});
