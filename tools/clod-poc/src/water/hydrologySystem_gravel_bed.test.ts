import { describe, expect, it } from "vitest";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import {
  HYDROLOGY_BODY_RIVER,
  type HydrologySample,
} from "./hydrologyGrid.js";
import { HydrologySystem } from "./hydrologySystem.js";
import type { HydrologyWorldSampler } from "./hydrologyTileSource.js";

function riverSample(): HydrologySample {
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
  };
}

function config(enabled: boolean) {
  const value = cloneHydrologyConfig();
  value.simRes = 9;
  value.infinite.unifiedStartup = true;
  value.infinite.maxResidentTiles = 0;
  value.gravelBars.enabled = true;
  value.gravelBars.strength = 1;
  value.gravelBars.patternStart = 0;
  value.gravelBars.patternEnd = 0.01;
  value.gravelBars.breakupStrength = 0;
  value.gravelBars.minShoreDistanceM = 0;
  value.gravelBars.maxShoreDistanceM = 10;
  value.gravelBars.minDepthM = 0;
  value.gravelBars.maxDepthM = 2;
  value.gravelBars.minFlowStrength = 0;
  value.gravelBars.maxFlowStrength = 1;
  value.gravelBed.enabled = enabled;
  value.gravelBed.maxElevationM = 0.5;
  value.gravelBed.minWetDepthM = 0.2;
  value.gravelBed.continuityReserveM = 0.1;
  value.gravelBed.bankClearanceM = 0.05;
  return value;
}

const worldSampler: HydrologyWorldSampler = () => riverSample();

describe("HydrologySystem gravel bed integration", () => {
  it("applies the authority to unified startup samples and publishes counters", () => {
    const system = HydrologySystem.build(
      config(true),
      160,
      { surfaceHeight: () => 12 },
      { infiniteWorldSamples: true, worldSampler },
    );

    expect(system.grid.carvedBed.some((height) => height > 10)).toBe(true);
    expect(system.stats.gravelBed.accepted).toBeGreaterThan(0);
    expect(system.gravelBedStats().accepted).toBe(system.stats.gravelBed.accepted);
    for (let index = 0; index < system.grid.carvedBed.length; index += 1) {
      const depth = system.grid.waterY[index]! - system.grid.carvedBed[index]!;
      expect(depth).toBeGreaterThanOrEqual(0.2 - 1e-5);
    }
  });

  it("keeps unified startup beds unchanged while disabled", () => {
    const system = HydrologySystem.build(
      config(false),
      160,
      { surfaceHeight: () => 12 },
      { infiniteWorldSamples: true, worldSampler },
    );

    expect(Array.from(system.grid.carvedBed)).toEqual(
      new Array(system.grid.carvedBed.length).fill(10),
    );
    expect(system.stats.gravelBed.accepted).toBe(0);
    expect(system.gravelBedStats().candidates).toBe(0);
  });
});
