import { describe, expect, it } from "vitest";
import { DEFAULT_HYDROLOGY_CONFIG } from "./hydrologyConfig.js";
import { HYDROLOGY_BODY_RIVER, type HydrologySample } from "./hydrologyGrid.js";
import { createRuntimeGravelBedTerrainResolver } from "./runtime_gravel_bed_terrain.js";

const terrain = { surfaceHeight: () => 20 };

function riverSample(): HydrologySample {
  return {
    terrainY: 10,
    waterY: 12,
    depth: 2,
    bodyMask: 0.8,
    lakeMask: 0,
    riverMask: 0.8,
    flowX: 1,
    flowZ: 0,
    flowStrength: 0.5,
    riverDepth: 2,
    waterYFar: 12,
    moisture: 1,
    bodyKind: HYDROLOGY_BODY_RIVER,
    bodyId: 42,
    shoreDistance: 4,
  };
}

function enabledField() {
  return {
    ...DEFAULT_HYDROLOGY_CONFIG.gravelBars,
    enabled: true,
    strength: 1,
    longitudinalPeriodM: 11,
    crossPeriodM: 7,
    patternStart: 0,
    patternEnd: 0.01,
    breakupStrength: 0,
    minShoreDistanceM: 0,
    maxShoreDistanceM: 8,
    minDepthM: 0,
    maxDepthM: 4,
    minFlowStrength: 0,
    maxFlowStrength: 1,
  };
}

function enabledBed() {
  return {
    ...DEFAULT_HYDROLOGY_CONFIG.gravelBed,
    enabled: true,
    maxElevationM: 0.7,
    minWetDepthM: 0.1,
    continuityReserveM: 0.1,
    bankClearanceM: 0.1,
  };
}

describe("runtime gravel-bed terrain resolver", () => {
  it("tracks runtime setting replacement without rebuilding the terrain carver", () => {
    let field = { ...enabledField(), enabled: false };
    let bed = enabledBed();
    const resolve = createRuntimeGravelBedTerrainResolver(terrain, {
      readField: () => field,
      readBed: () => bed,
    });
    const source = riverSample();

    expect(resolve(3, 5, source)).toBe(source);

    field = enabledField();
    let raised: HydrologySample | null = null;
    for (let z = 0; z < 24 && !raised; z += 1) {
      for (let x = 0; x < 24; x += 1) {
        const sample = resolve(x, z, source);
        if (sample.terrainY > source.terrainY) {
          raised = sample;
          break;
        }
      }
    }

    expect(raised).not.toBeNull();
    expect(raised!.waterY).toBe(source.waterY);
    expect(raised!.depth).toBeCloseTo(raised!.waterY - raised!.terrainY, 10);
    expect(raised!.riverDepth).toBe(raised!.depth);
    expect(raised!.terrainY).toBeLessThanOrEqual(source.waterY - bed.minWetDepthM);
  });
});
