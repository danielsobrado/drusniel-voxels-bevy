import { describe, expect, it } from "vitest";
import {
  WATER_FOAM_REFERENCE_ALBEDO,
  resolveWaterFoamAlbedo,
} from "./water_foam_albedo.js";

describe("water foam albedo", () => {
  it("uses the Fable5 neutral albedo for an uncoloured tint", () => {
    expect(resolveWaterFoamAlbedo([1, 1, 1])).toEqual(WATER_FOAM_REFERENCE_ALBEDO);
  });

  it("removes brightness from the existing blue-white authoring colour", () => {
    const result = resolveWaterFoamAlbedo([0.90, 0.95, 0.96]);

    expect(result[0]).toBeCloseTo(0.7337, 3);
    expect(result[1]).toBeCloseTo(0.7617, 3);
    expect(result[2]).toBeCloseTo(0.7430, 3);
  });

  it("preserves restrained chroma without allowing configured brightness to dominate", () => {
    const result = resolveWaterFoamAlbedo([0.4, 0.8, 1]);

    expect(result[2]).toBeGreaterThan(result[0]);
    expect(Math.max(...result)).toBeLessThan(0.9);
  });

  it("fails closed for invalid or black authoring colours", () => {
    expect(resolveWaterFoamAlbedo([Number.NaN, 0, 0])).toEqual([0, 0, 0]);
    const black = resolveWaterFoamAlbedo([0, 0, 0]);
    expect(black[0]).toBeCloseTo(0.592, 6);
    expect(black[1]).toBeCloseTo(0.608, 6);
    expect(black[2]).toBeCloseTo(0.592, 6);
  });
});
