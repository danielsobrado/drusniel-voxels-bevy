import { afterEach, describe, expect, it } from "vitest";
import { classifyTerrainMaterial } from "../../terrainMaterial/terrainMaterialBands.js";
import {
  clearActiveErodedMacroField,
  getActiveErodedMacroField,
  getActiveErosionWorldId,
  sampleActiveErosionMaterialChannels,
  setActiveErodedMacroField,
} from "./integration.js";
import type { ErodedMacroField } from "./types.js";

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

function authority(): ErodedMacroField {
  return {
    width: 2,
    height: 2,
    cellSizeM: 16,
    originX: -16,
    originZ: 8,
    heightFixed: new Int32Array(4),
    hardness: new Uint16Array(4).fill(32768),
    sediment: new Uint32Array(4).fill(65536),
    deposition: new Int32Array(4).fill(32768),
    sampleHeightMeters: () => 0,
  };
}

afterEach(() => clearActiveErodedMacroField());

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

  it("does not repeat edge channels outside the artifact footprint", () => {
    setActiveErodedMacroField(authority(), "world-a");
    expect(sampleActiveErosionMaterialChannels(-16, 8)).not.toBeNull();
    expect(sampleActiveErosionMaterialChannels(0, 24)).not.toBeNull();
    expect(sampleActiveErosionMaterialChannels(-16.001, 8)).toBeNull();
    expect(sampleActiveErosionMaterialChannels(0, 24.001)).toBeNull();
  });

  it("keeps active authority scoped to its world", () => {
    const field = authority();
    setActiveErodedMacroField(field, "world-a");
    expect(getActiveErodedMacroField("world-a")).toBe(field);
    expect(getActiveErodedMacroField("world-b")).toBeNull();
    expect(getActiveErosionWorldId()).toBe("world-a");
    clearActiveErodedMacroField("world-b");
    expect(getActiveErodedMacroField("world-a")).toBe(field);
    clearActiveErodedMacroField("world-a");
    expect(getActiveErodedMacroField()).toBeNull();
  });
});
