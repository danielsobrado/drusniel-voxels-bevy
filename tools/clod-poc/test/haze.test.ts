import { describe, expect, it } from "vitest";
import { computeHaze, blendWithHaze, computeHazeRange } from "../src/terrainMaterial/haze.js";

const HAZE_PARAMS = {
  enabled: true,
  start_m: 1800,
  end_m: 4096,
  color: [0.62, 0.70, 0.76] as [number, number, number],
  strength: 0.72,
  height_falloff: 0.035,
};

describe("computeHaze", () => {
  it("returns 0 factor when disabled", () => {
    const result = computeHaze(5000, 0, { ...HAZE_PARAMS, enabled: false });
    expect(result.factor).toBe(0);
  });

  it("returns 0 factor before start distance", () => {
    const result = computeHaze(500, 0, HAZE_PARAMS);
    expect(result.factor).toBe(0);
  });

  it("returns near-1 factor near end distance at low height", () => {
    const result = computeHaze(4096, 0, HAZE_PARAMS);
    expect(result.factor).toBeGreaterThan(0.65);
    expect(result.factor).toBeLessThanOrEqual(1);
  });

  it("returns blended color matching haze color at high factor", () => {
    const result = computeHaze(5000, 0, HAZE_PARAMS);
    expect(result.blendedColor[0]).toBe(HAZE_PARAMS.color[0]);
    expect(result.blendedColor[1]).toBe(HAZE_PARAMS.color[1]);
    expect(result.blendedColor[2]).toBe(HAZE_PARAMS.color[2]);
  });

  it("height falloff reduces haze at altitude", () => {
    const low = computeHaze(3000, 0, HAZE_PARAMS);
    const high = computeHaze(3000, 200, HAZE_PARAMS);
    expect(high.factor).toBeLessThan(low.factor);
  });

  it("is 0 before start", () => {
    for (let d = 0; d < 1800; d += 200) {
      const result = computeHaze(d, 0, HAZE_PARAMS);
      expect(result.factor).toBe(0);
    }
  });

  it("approaches 1 near end", () => {
    const result = computeHaze(4096, 0, {
      ...HAZE_PARAMS,
      strength: 1,
      height_falloff: 0,
    });
    expect(result.factor).toBeCloseTo(1, 1);
  });

  it("handles zero start/end range without division by zero", () => {
    const result = computeHaze(100, 0, {
      ...HAZE_PARAMS,
      start_m: 100,
      end_m: 100,
    });
    expect(result.factor).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.factor)).toBe(true);
  });

  it("no NaN for extreme distances", () => {
    const result = computeHaze(1e9, 1e6, HAZE_PARAMS);
    expect(Number.isFinite(result.factor)).toBe(true);
    expect(result.factor).toBeGreaterThanOrEqual(0);
    expect(result.factor).toBeLessThanOrEqual(1);
  });
});

describe("blendWithHaze", () => {
  it("returns original when factor is 0", () => {
    const orig: [number, number, number] = [0.3, 0.5, 0.2];
    const result = blendWithHaze(orig, { factor: 0, blendedColor: [1, 0, 0] });
    expect(result).toEqual(orig);
  });

  it("blends toward haze color", () => {
    const orig: [number, number, number] = [0, 0, 0];
    const result = blendWithHaze(orig, { factor: 0.5, blendedColor: [1, 1, 1] });
    expect(result[0]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(0.5);
  });

  it("clamps to 0-1 range", () => {
    const orig: [number, number, number] = [2, -1, 0.5];
    const result = blendWithHaze(orig, { factor: 0.5, blendedColor: [0, 0.5, 1] });
    expect(result.every((v: number) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe("computeHazeRange", () => {
  it("returns 0 before start", () => {
    expect(computeHazeRange(0, 100, 200)).toBe(0);
  });

  it("returns 1 after end", () => {
    expect(computeHazeRange(300, 100, 200)).toBe(1);
  });

  it("returns 0.5 at midpoint", () => {
    expect(computeHazeRange(150, 100, 200)).toBeCloseTo(0.5);
  });

  it("is continuous", () => {
    expect(computeHazeRange(180, 100, 200)).toBeGreaterThan(0);
    expect(computeHazeRange(180, 100, 200)).toBeLessThan(1);
  });
});
