import { describe, it, expect } from "vitest";
import { sampleGridBilinearByRes } from "../water/hydrologyGrid.js";
import { surfaceHeightCore } from "./terrain_field_core.js";
import {
  placementGroundHeightCpu,
  sampleCarvedBedBilinear,
} from "./placement_height.js";

describe("placement_height carved-bed bilinear", () => {
  const res = 4;
  const worldCells = 128;
  const carvedBed = new Float32Array(res * res);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const wx = (x / (res - 1)) * worldCells;
      const wz = (z / (res - 1)) * worldCells;
      carvedBed[z * res + x] = 12 + wx * 0.08 + wz * 0.12 + (x * 3 + z) * 0.5;
    }
  }

  const xs = [8, 24.5, 63.25, 96.75, 120];
  const zs = [6, 31.5, 64, 88.25, 118];

  it("matches hydrologyGrid bilinear sampling", () => {
    for (const x of xs) {
      for (const z of zs) {
        expect(sampleCarvedBedBilinear(carvedBed, res, worldCells, x, z)).toBeCloseTo(
          sampleGridBilinearByRes(carvedBed, res, worldCells, x, z),
          5,
        );
      }
    }
  });

  it("uses carved bed when hydrology is enabled", () => {
    const x = 63.25;
    const z = 88.25;
    expect(placementGroundHeightCpu(x, z, true, carvedBed, res, worldCells)).toBeCloseTo(
      sampleGridBilinearByRes(carvedBed, res, worldCells, x, z),
      5,
    );
  });

  it("falls back to procedural height when hydrology is disabled", () => {
    const x = 63.25;
    const z = 88.25;
    expect(placementGroundHeightCpu(x, z, false, carvedBed, res, worldCells)).toBe(
      surfaceHeightCore(x, z),
    );
  });
});
