import { describe, expect, it } from "vitest";
import {
  WATER_FOAM_BASE_WEIGHT,
  WATER_FOAM_DETAIL_WEIGHT,
  WATER_FOAM_MAX_COVERAGE,
  WATER_FOAM_PATTERN_END,
  WATER_FOAM_PATTERN_START,
  WATER_FOAM_RIVER_SHORE_ATTENUATION,
  WATER_FOAM_SHADE_COVERAGE_FLOOR,
  evaluateWaterFoam,
  rapidFoamEligibility,
} from "./water_foam_model.js";

const BASE = {
  shoreContact: 0,
  rapidSpeed: 0,
  rapidDrop: 0,
  riverWeight: 1,
  pattern: 1,
  wetFade: 1,
  sunVisibility: 1,
  detailFade: 1,
  shoreStrength: 0.52,
  riverStrength: 0.38,
  bankStrength: 0.45,
  rapidStrength: 1,
} as const;

describe("water foam parity model", () => {
  it("matches the Fable5 breakup and coverage envelope", () => {
    expect(WATER_FOAM_PATTERN_START).toBe(0.42);
    expect(WATER_FOAM_PATTERN_END).toBe(0.85);
    expect(WATER_FOAM_BASE_WEIGHT).toBe(0.62);
    expect(WATER_FOAM_DETAIL_WEIGHT).toBe(0.38);
    expect(WATER_FOAM_BASE_WEIGHT + WATER_FOAM_DETAIL_WEIGHT).toBeCloseTo(1);
    expect(WATER_FOAM_MAX_COVERAGE).toBe(0.68);
  });

  it("requires both flow speed and local drop for rapid foam", () => {
    expect(rapidFoamEligibility(1, 0, 1)).toBe(0);
    expect(rapidFoamEligibility(0, 1, 1)).toBe(0);
    expect(rapidFoamEligibility(1, 1, 0)).toBe(0);
    expect(rapidFoamEligibility(0.5, 0.8, 1)).toBeCloseTo(0.4);
  });

  it("has no permanent foam floor when the coherent pattern is absent", () => {
    const result = evaluateWaterFoam({
      ...BASE,
      rapidSpeed: 1,
      rapidDrop: 1,
      pattern: 0,
    });

    expect(result.rapidSource).toBe(1);
    expect(result.coverage).toBe(0);
  });

  it("multiplies shore and river sources by the same breakup pattern", () => {
    const fixture = {
      ...BASE,
      shoreContact: 1,
      rapidSpeed: 1,
      rapidDrop: 1,
      shoreStrength: 0.1,
      riverStrength: 0.1,
      bankStrength: 0.1,
      rapidStrength: 0.1,
    };
    const full = evaluateWaterFoam({ ...fixture, pattern: 1 });
    const half = evaluateWaterFoam({ ...fixture, pattern: 0.5 });

    expect(half.coverage).toBeCloseTo(full.coverage * 0.5);
  });

  it("attenuates continuous river-shore foam while retaining lake shoreline foam", () => {
    const lake = evaluateWaterFoam({
      ...BASE,
      riverWeight: 0,
      shoreContact: 1,
      shoreStrength: 0.2,
    });
    const river = evaluateWaterFoam({
      ...BASE,
      riverWeight: 1,
      shoreContact: 1,
      shoreStrength: 0.2,
      riverStrength: 0,
      bankStrength: 0,
    });

    expect(river.shoreSource).toBeCloseTo(lake.shoreSource * WATER_FOAM_RIVER_SHORE_ATTENUATION);
  });

  it("retains reduced whitewater coverage in full shade", () => {
    const fixture = {
      ...BASE,
      shoreContact: 1,
      rapidSpeed: 1,
      rapidDrop: 1,
      shoreStrength: 0.1,
      riverStrength: 0.1,
      bankStrength: 0.1,
      rapidStrength: 0.1,
    };
    const sunlit = evaluateWaterFoam({ ...fixture, sunVisibility: 1 });
    const shaded = evaluateWaterFoam({ ...fixture, sunVisibility: 0 });

    expect(shaded.shadeCoverage).toBe(WATER_FOAM_SHADE_COVERAGE_FLOOR);
    expect(shaded.coverage).toBeCloseTo(sunlit.coverage * WATER_FOAM_SHADE_COVERAGE_FLOOR);
  });

  it("applies one continuous detail fade to every foam source", () => {
    const fixture = {
      ...BASE,
      shoreContact: 1,
      rapidSpeed: 1,
      rapidDrop: 1,
      shoreStrength: 0.1,
      riverStrength: 0.1,
      bankStrength: 0.1,
      rapidStrength: 0.1,
    };
    const full = evaluateWaterFoam({ ...fixture, detailFade: 1 });
    const half = evaluateWaterFoam({ ...fixture, detailFade: 0.5 });
    const absent = evaluateWaterFoam({ ...fixture, detailFade: 0 });

    expect(half.coverage).toBeCloseTo(full.coverage * 0.5);
    expect(half.detailFade).toBe(0.5);
    expect(absent.coverage).toBe(0);
  });

  it("caps bright whitewater coverage at the parity limit", () => {
    const result = evaluateWaterFoam({
      ...BASE,
      shoreContact: 1,
      rapidSpeed: 1,
      rapidDrop: 1,
      shoreStrength: 5,
      riverStrength: 5,
      bankStrength: 5,
      rapidStrength: 5,
    });

    expect(result.coverage).toBe(WATER_FOAM_MAX_COVERAGE);
  });

  it("keeps a smooth fast river clear when local drop is absent", () => {
    const result = evaluateWaterFoam({
      ...BASE,
      rapidSpeed: 1,
      rapidDrop: 0,
    });

    expect(result.rapidSource).toBe(0);
    expect(result.coverage).toBe(0);
  });
});
