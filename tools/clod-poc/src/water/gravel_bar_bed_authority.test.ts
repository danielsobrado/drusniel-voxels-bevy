import { describe, expect, it } from "vitest";
import {
  cloneHydrologyConfig,
} from "./hydrologyConfig.js";
import {
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_RIVER,
  createHydrologyGrid,
  type HydrologySample,
} from "./hydrologyGrid.js";
import {
  applyGravelBarBedToGrid,
  createGravelBarBedAuthority,
} from "./gravel_bar_bed_authority.js";

function riverSample(overrides: Partial<HydrologySample> = {}): HydrologySample {
  return {
    terrainY: 10,
    waterY: 11,
    depth: 1,
    bodyMask: 1,
    lakeMask: 0,
    riverMask: 1,
    flowX: 1,
    flowZ: 0,
    flowStrength: 0.4,
    riverDepth: 1,
    waterYFar: 11,
    moisture: 1,
    bodyKind: HYDROLOGY_BODY_RIVER,
    bodyId: 41,
    shoreDistance: 2,
    ...overrides,
  };
}

function enabledConfig() {
  const config = cloneHydrologyConfig();
  config.gravelBars.enabled = true;
  config.gravelBars.strength = 1;
  config.gravelBars.patternStart = 0;
  config.gravelBars.patternEnd = 0.01;
  config.gravelBars.breakupStrength = 0;
  config.gravelBars.minShoreDistanceM = 0;
  config.gravelBars.maxShoreDistanceM = 10;
  config.gravelBars.minDepthM = 0;
  config.gravelBars.maxDepthM = 2;
  config.gravelBars.minFlowStrength = 0;
  config.gravelBars.maxFlowStrength = 1;
  config.gravelBed.enabled = true;
  config.gravelBed.maxElevationM = 0.5;
  config.gravelBed.minWetDepthM = 0.2;
  config.gravelBed.continuityReserveM = 0.1;
  config.gravelBed.bankClearanceM = 0.05;
  return config;
}

function acceptedCoordinate(authority: ReturnType<typeof createGravelBarBedAuthority>): { x: number; z: number } {
  for (let z = 0; z <= 160; z += 4) {
    for (let x = 0; x <= 160; x += 4) {
      if (authority.apply(x, z, riverSample()).terrainY > 10) return { x, z };
    }
  }
  throw new Error("fixture did not produce a gravel-bed candidate");
}

describe("gravel bar bed hydrology authority", () => {
  it("preserves exact sample identity while disabled", () => {
    const config = enabledConfig();
    config.gravelBed.enabled = false;
    const authority = createGravelBarBedAuthority(
      config.gravelBars,
      config.gravelBed,
      { surfaceHeight: () => 12 },
    );
    const sample = riverSample();
    expect(authority.apply(12, 24, sample)).toBe(sample);
    expect(authority.counters.candidates).toBe(0);
  });

  it("raises only the bed while preserving water and depth invariants", () => {
    const config = enabledConfig();
    const authority = createGravelBarBedAuthority(
      config.gravelBars,
      config.gravelBed,
      { surfaceHeight: () => 12 },
    );
    const coordinate = acceptedCoordinate(authority);
    const result = authority.apply(coordinate.x, coordinate.z, riverSample());

    expect(result.terrainY).toBeGreaterThan(10);
    expect(result.waterY).toBe(11);
    expect(result.depth).toBeCloseTo(result.waterY - result.terrainY, 6);
    expect(result.depth).toBeGreaterThanOrEqual(config.gravelBed.minWetDepthM);
    expect(result.riverDepth).toBe(result.depth);
    expect(authority.counters.accepted).toBeGreaterThan(0);
  });

  it("fails closed for non-river water", () => {
    const config = enabledConfig();
    const authority = createGravelBarBedAuthority(
      config.gravelBars,
      config.gravelBed,
      { surfaceHeight: () => 12 },
    );
    const lake = riverSample({ bodyKind: HYDROLOGY_BODY_LAKE, riverMask: 0, lakeMask: 1 });
    expect(authority.apply(12, 24, lake)).toBe(lake);
  });

  it("applies the same authority to finite-grid carved beds", () => {
    const config = enabledConfig();
    const grid = createHydrologyGrid(9, 160, { surfaceHeight: () => 12 });
    for (let index = 0; index < grid.carvedBed.length; index += 1) {
      grid.carvedBed[index] = 10;
      grid.waterY[index] = 11;
      grid.waterYRaw[index] = 11;
      grid.wetMask[index] = 1;
      grid.riverMask[index] = 1;
      grid.flowStrength[index] = 0.4;
      grid.riverDepth[index] = 1;
      grid.moisture[index] = 1;
      grid.bodyKind[index] = HYDROLOGY_BODY_RIVER;
      grid.bodyId[index] = 41;
      grid.shoreDistance[index] = 2;
      grid.flowDirX[index] = 1;
    }

    const before = grid.carvedBed.slice();
    const counters = applyGravelBarBedToGrid(grid, config.gravelBars, config.gravelBed);

    expect(counters.accepted).toBeGreaterThan(0);
    expect(grid.carvedBed.some((height, index) => height > before[index]!)).toBe(true);
    for (let index = 0; index < grid.carvedBed.length; index += 1) {
      if (grid.carvedBed[index] === before[index]) continue;
      expect(grid.waterY[index] - grid.carvedBed[index]).toBeCloseTo(grid.riverDepth[index]!, 5);
      expect(grid.riverDepth[index]).toBeGreaterThanOrEqual(config.gravelBed.minWetDepthM);
    }
  });
});
