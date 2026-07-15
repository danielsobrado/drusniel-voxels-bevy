import { describe, expect, it } from "vitest";
import { classifyTerrainMaterial } from "../../terrainMaterial/terrainMaterialBands.js";

const CONFIG = {
  waterline_m: 0,
  sand_max_height_m: 4,
  grass_max_slope: 0.62,
  dirt_max_slope: 0.82,
  rock_min_slope: 0.72,
  snow_min_height_m: 96,
  snow_min_slope: 0.15,
  macro_variation: {
    enabled: false,
    world_scale_1: 180,
    world_scale_2: 720,
    strength: 0.18,
    slope_strength: 0.12,
    height_strength: 0.1,
  },
};

function baseInput() {
  return {
    worldX: 128,
    worldZ: 256,
    height: 32,
    slope: 0.25,
    waterLevel: 0,
    config: CONFIG,
  };
}

describe("erosion material integration", () => {
  it("uses only explicitly supplied erosion channels", () => {
    const base = classifyTerrainMaterial(baseInput());
    const eroded = classifyTerrainMaterial({
      ...baseInput(),
      erosion: {
        sedimentDepthM: 0,
        netDepositionM: -0.5,
        hardness01: 0.95,
        wetnessSeed: 0,
      },
    });
    expect(eroded.weights.rock).toBeGreaterThan(base.weights.rock);
    expect(eroded.weights.grass).toBeLessThan(base.weights.grass);
  });

  it("increases soil weight for deposited sediment", () => {
    const base = classifyTerrainMaterial(baseInput());
    const deposited = classifyTerrainMaterial({
      ...baseInput(),
      erosion: {
        sedimentDepthM: 0.25,
        netDepositionM: 0.4,
        hardness01: 0.2,
        wetnessSeed: 0.8,
      },
    });
    expect(deposited.weights.dirt).toBeGreaterThan(base.weights.dirt);
  });
});
