import { describe, expect, it } from "vitest";
import { classifyTerrainMaterial, materialColorForDebugId } from "../src/terrainMaterial/terrainMaterialBands.js";

const BASE_CONFIG = {
  waterline_m: 0.0,
  sand_max_height_m: 4.0,
  grass_max_slope: 0.62,
  dirt_max_slope: 0.82,
  rock_min_slope: 0.72,
  snow_min_height_m: 96.0,
  snow_min_slope: 0.15,
  macro_variation: {
    enabled: true,
    world_scale_1: 180.0,
    world_scale_2: 720.0,
    strength: 0.18,
    slope_strength: 0.12,
    height_strength: 0.10,
  },
};

describe("classifyTerrainMaterial", () => {
  it("returns deterministic results for same input", () => {
    const input = {
      worldX: 100,
      worldZ: 200,
      height: 50,
      slope: 0.3,
      waterLevel: 0,
      config: BASE_CONFIG,
    };
    const a = classifyTerrainMaterial(input);
    const b = classifyTerrainMaterial(input);
    expect(a.materialId).toBe(b.materialId);
    expect(a.baseColor).toEqual(b.baseColor);
    expect(a.weights.grass).toBe(b.weights.grass);
  });

  it("returns sand near waterline", () => {
    const result = classifyTerrainMaterial({
      worldX: 100,
      worldZ: 200,
      height: 1,
      slope: 0.1,
      waterLevel: 0,
      config: BASE_CONFIG,
    });
    expect(result.materialId).toBe("sand");
    expect(result.weights.sand).toBeGreaterThan(0.5);
  });

  it("returns sand below waterline", () => {
    const result = classifyTerrainMaterial({
      worldX: 100,
      worldZ: 200,
      height: -2,
      slope: 0.1,
      waterLevel: 0,
      config: BASE_CONFIG,
    });
    expect(result.materialId).toBe("sand");
    expect(result.weights.sand).toBeGreaterThan(0);
  });

  it("returns grass on gentle slopes", () => {
    const result = classifyTerrainMaterial({
      worldX: 300,
      worldZ: 400,
      height: 30,
      slope: 0.3,
      waterLevel: 0,
      config: BASE_CONFIG,
    });
    expect(result.materialId).toBe("grass");
    expect(result.weights.grass).toBeGreaterThan(0);
  });

  it("returns rock on steep slopes", () => {
    const result = classifyTerrainMaterial({
      worldX: 500,
      worldZ: 600,
      height: 30,
      slope: 0.85,
      waterLevel: 0,
      config: BASE_CONFIG,
    });
    expect(result.materialId).toBe("rock");
    expect(result.weights.rock).toBeGreaterThan(0.5);
  });

  it("returns snow at high elevation with sufficient slope", () => {
    const result = classifyTerrainMaterial({
      worldX: 700,
      worldZ: 800,
      height: 150,
      slope: 0.4,
      waterLevel: 0,
      config: BASE_CONFIG,
    });
    expect(result.materialId).toBe("snow");
    expect(result.weights.snow).toBeGreaterThan(0.3);
  });

  it("does not return snow at high elevation with very low slope", () => {
    const result = classifyTerrainMaterial({
      worldX: 700,
      worldZ: 800,
      height: 150,
      slope: 0.05,
      waterLevel: 0,
      config: BASE_CONFIG,
    });
    expect(result.materialId).not.toBe("snow");
  });

  it("increases rock weight with slope", () => {
    const lowSlope = classifyTerrainMaterial({
      worldX: 100, worldZ: 100,
      height: 50, slope: 0.5, waterLevel: 0, config: BASE_CONFIG,
    });
    const highSlope = classifyTerrainMaterial({
      worldX: 100, worldZ: 100,
      height: 50, slope: 0.9, waterLevel: 0, config: BASE_CONFIG,
    });
    expect(highSlope.weights.rock).toBeGreaterThan(lowSlope.weights.rock);
  });

  it("increases snow weight with height", () => {
    const low = classifyTerrainMaterial({
      worldX: 100, worldZ: 100,
      height: 80, slope: 0.5, waterLevel: 0, config: BASE_CONFIG,
    });
    const high = classifyTerrainMaterial({
      worldX: 100, worldZ: 100,
      height: 200, slope: 0.5, waterLevel: 0, config: BASE_CONFIG,
    });
    expect(high.weights.snow).toBeGreaterThan(low.weights.snow);
  });

  it("returns deterministic macro noise for same world coordinate", () => {
    const r1 = classifyTerrainMaterial({
      worldX: 1234.5, worldZ: 6789.1,
      height: 50, slope: 0.3, waterLevel: 0, config: BASE_CONFIG,
    });
    const r2 = classifyTerrainMaterial({
      worldX: 1234.5, worldZ: 6789.1,
      height: 50, slope: 0.3, waterLevel: 0, config: BASE_CONFIG,
    });
    expect(r1.macroVariation).toBe(r2.macroVariation);
  });

  it("normalizes weights to sum to 1", () => {
    const result = classifyTerrainMaterial({
      worldX: 555, worldZ: 666,
      height: 30, slope: 0.6, waterLevel: 0, config: BASE_CONFIG,
    });
    const sum = result.weights.sand + result.weights.grass + result.weights.dirt + result.weights.rock + result.weights.snow;
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });

  it("handles extreme coordinates without NaN/Infinity", () => {
    const extremes = [
      { worldX: 1e8, worldZ: 1e8, height: 1e4, slope: 0.99 },
      { worldX: -1e8, worldZ: -1e8, height: -500, slope: 0 },
      { worldX: 0, worldZ: 0, height: 0, slope: 0.5 },
      { worldX: Number.MAX_SAFE_INTEGER, worldZ: Number.MAX_SAFE_INTEGER, height: 1e6, slope: 0.3 },
    ];
    for (const ex of extremes) {
      const result = classifyTerrainMaterial({
        worldX: ex.worldX,
        worldZ: ex.worldZ,
        height: ex.height,
        slope: ex.slope,
        waterLevel: 0,
        config: BASE_CONFIG,
      });
      expect(result.valid).toBe(true);
      expect(result.baseColor.every((v: number) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      expect(result.weights.sand).toBeGreaterThanOrEqual(0);
      expect(result.weights.grass).toBeGreaterThanOrEqual(0);
      expect(result.weights.dirt).toBeGreaterThanOrEqual(0);
      expect(result.weights.rock).toBeGreaterThanOrEqual(0);
      expect(result.weights.snow).toBeGreaterThanOrEqual(0);
    }
  });

  it("produces debugWeights matching weights", () => {
    const result = classifyTerrainMaterial({
      worldX: 100, worldZ: 200,
      height: 50, slope: 0.4, waterLevel: 0, config: BASE_CONFIG,
    });
    expect(result.debugWeights[0]).toBe(result.weights.sand);
    expect(result.debugWeights[1]).toBe(result.weights.grass);
    expect(result.debugWeights[2]).toBe(result.weights.dirt);
    expect(result.debugWeights[3]).toBe(result.weights.rock);
    expect(result.debugWeights[4]).toBe(result.weights.snow);
  });
});

describe("materialColorForDebugId", () => {
  it("returns a color for each material ID", () => {
    for (let i = 0; i < 5; i++) {
      const color = materialColorForDebugId(i);
      expect(color.length).toBe(3);
      expect(color.every((v: number) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it("returns a valid color for out-of-range ID", () => {
    const color = materialColorForDebugId(99);
    expect(color.length).toBe(3);
  });
});
