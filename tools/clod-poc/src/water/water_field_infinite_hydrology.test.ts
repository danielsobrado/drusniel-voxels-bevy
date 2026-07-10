import { describe, expect, it } from "vitest";
import { cloneWaterConfig, WaterField, type HydrologySystem } from "./index.js";
import { HYDROLOGY_BODY_LAKE, type HydrologySample } from "./hydrologyGrid.js";

function wetSample(x: number, z: number): HydrologySample {
  const terrainY = x * 0.01 + z * 0.001;
  return {
    terrainY,
    waterY: terrainY + 1,
    depth: 1,
    bodyMask: 1,
    lakeMask: 1,
    riverMask: 0,
    flowX: 0,
    flowZ: 0,
    flowStrength: 0,
    riverDepth: 0,
    waterYFar: terrainY + 1,
    moisture: 1,
    bodyKind: HYDROLOGY_BODY_LAKE,
    bodyId: 1,
    shoreDistance: 5,
  };
}

function hydrologyMock(infinite: boolean): HydrologySystem {
  return {
    grid: { worldCells: 1024, res: 2 },
    supportsInfiniteWorldSamples: () => infinite,
    sample: wetSample,
    terrainHeight: (x: number, z: number) => wetSample(x, z).terrainY,
  } as unknown as HydrologySystem;
}

describe("WaterField infinite hydrology bounds", () => {
  it("allows hydrology sampling outside world bounds when hydrology supports infinite samples", () => {
    const config = cloneWaterConfig();
    config.source = "hydrology";
    const field = new WaterField(config, { surfaceHeight: () => 0 }, hydrologyMock(true), 1024);

    expect(field.sample(1500, -300).bodyMask).toBe(1);
    expect(field.sample(1500, -300).depth).toBeGreaterThan(0);
  });

  it("keeps finite hydrology dry outside world bounds", () => {
    const config = cloneWaterConfig();
    config.source = "hydrology";
    const field = new WaterField(config, { surfaceHeight: () => 0 }, hydrologyMock(false), 1024);

    expect(field.sample(1500, -300).bodyMask).toBe(0);
    expect(field.sample(1500, -300).depth).toBeLessThan(0);
  });
});
