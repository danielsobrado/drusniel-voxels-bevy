import { describe, expect, it } from "vitest";
import {
  createHydrologyGrid,
  gridIndex,
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_RIVER,
  type HydrologyGrid,
} from "./hydrologyGrid.js";
import type { HydrologyWaterSurfaceConfig } from "./hydrologyConfig.js";
import { buildWaterSurface } from "./waterSurfaceBuild.js";

const SURFACE_CONFIG: HydrologyWaterSurfaceConfig = {
  wetSmoothIterations: 2,
  wetToWetCliffSlopeMax: 100, // effectively disable cliff deletion for these unit cases
  farReduceFactor: 1,
  farLevelMinCellSize: 12,
  drySentinelDepth: 2,
  farLakeDominance: 0.4,
  farRiverDominance: 0.3,
  farWetThreshold: 0.1,
};

function baseGrid(res: number): HydrologyGrid {
  const grid = createHydrologyGrid(res, res - 1, { surfaceHeight: () => 0 });
  grid.wetMask.fill(0);
  grid.bodyKind.fill(HYDROLOGY_BODY_DRY);
  grid.carvedBed.fill(0);
  grid.waterYRaw.fill(-2000); // dry sentinel
  grid.lakeMask.fill(0);
  grid.riverMask.fill(0);
  grid.flowDirX.fill(0);
  grid.flowDirZ.fill(0);
  return grid;
}

describe("buildWaterSurface — lake flatness", () => {
  it("flattens a still-water body to a single constant surface above its bed", () => {
    const res = 5;
    const grid = baseGrid(res);
    // 3x3 lake body with lumpy raw levels; bed well below.
    for (let z = 1; z <= 3; z++) {
      for (let x = 1; x <= 3; x++) {
        const i = gridIndex(res, x, z);
        const level = 10 + ((x + z) % 2 === 0 ? 0.8 : -0.6);
        grid.waterYRaw[i] = level;
        grid.bodyKind[i] = HYDROLOGY_BODY_LAKE;
        grid.lakeMask[i] = 1;
        grid.carvedBed[i] = 2;
      }
    }
    buildWaterSurface(grid, SURFACE_CONFIG, SURFACE_CONFIG.drySentinelDepth);

    let min = Infinity;
    let max = -Infinity;
    for (let z = 1; z <= 3; z++) {
      for (let x = 1; x <= 3; x++) {
        const i = gridIndex(res, x, z);
        expect(grid.wetMask[i]).toBe(1);
        min = Math.min(min, grid.waterY[i]);
        max = Math.max(max, grid.waterY[i]);
        expect(grid.waterY[i]).toBeGreaterThanOrEqual(grid.carvedBed[i]);
      }
    }
    expect(max - min).toBeLessThan(1e-6); // perfectly flat
    // Constant level lands inside the raw spread (mean of the smoothed field), not tilted.
    expect(min).toBeGreaterThan(9.4);
    expect(min).toBeLessThan(10.8);
  });
});

describe("buildWaterSurface — river monotonicity", () => {
  it("keeps a downhill channel surface non-increasing and never below the bed", () => {
    const res = 6;
    const grid = baseGrid(res);
    // Single-row channel flowing +x. Raw surface has an uphill bump mid-channel.
    const z = 2;
    const rawLevels = [8, 9, 5, 6, 4];
    for (let x = 0; x < rawLevels.length; x++) {
      const i = gridIndex(res, x, z);
      grid.waterYRaw[i] = rawLevels[x];
      grid.bodyKind[i] = HYDROLOGY_BODY_RIVER;
      grid.riverMask[i] = 1;
      grid.carvedBed[i] = 0;
      grid.flowDirX[i] = 1; // flow toward +x
    }
    buildWaterSurface(grid, SURFACE_CONFIG, SURFACE_CONFIG.drySentinelDepth);

    let prev = Infinity;
    for (let x = 0; x < rawLevels.length; x++) {
      const w = grid.waterY[gridIndex(res, x, z)];
      expect(w).toBeGreaterThanOrEqual(grid.carvedBed[gridIndex(res, x, z)]); // depth >= 0
      expect(w).toBeLessThanOrEqual(prev + 1e-6); // non-increasing downstream (flat bed)
      prev = w;
    }
  });
});
