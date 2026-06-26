import { describe, expect, it } from "vitest";
import { computeFarNormal } from "../src/terrainMaterial/farNormals.js";

const PARAMS = {
  mode: "analytic_summary",
  strength: 0.65,
  finite_difference_m: 8.0,
  flatten_with_distance: true,
  flatten_start_m: 2200,
  flatten_end_m: 4096,
};

function flatHeight(_x: number, _z: number): number {
  return 100;
}

function slopedHeight(x: number, _z: number): number {
  return 100 + x * 0.1;
}

function ridgeHeight(x: number, z: number): number {
  return 100 + Math.sin(x * 0.01) * 20 + Math.cos(z * 0.01) * 15;
}

describe("computeFarNormal", () => {
  it("returns up-normal for flat terrain", () => {
    const result = computeFarNormal(flatHeight, 500, 500, PARAMS);
    expect(result.ny).toBeGreaterThan(0.9);
    expect(Math.abs(result.nx)).toBeLessThan(0.1);
    expect(Math.abs(result.nz)).toBeLessThan(0.1);
  });

  it("returns non-zero slope for sloped terrain", () => {
    const result = computeFarNormal(slopedHeight, 500, 500, PARAMS);
    expect(result.slope).toBeGreaterThan(0.01);
  });

  it("no NaN/Infinity for normal result", () => {
    const result = computeFarNormal(ridgeHeight, 1234, 5678, PARAMS);
    expect(Number.isFinite(result.nx)).toBe(true);
    expect(Number.isFinite(result.ny)).toBe(true);
    expect(Number.isFinite(result.nz)).toBe(true);
    expect(Number.isFinite(result.slope)).toBe(true);
  });

  it("normal length is approximately 1", () => {
    for (const x of [0, 500, 2000, 5000]) {
      for (const z of [0, 500, 2000, 5000]) {
        const result = computeFarNormal(ridgeHeight, x, z, PARAMS);
        const len = Math.hypot(result.nx, result.ny, result.nz);
        expect(Math.abs(len - 1)).toBeLessThan(0.01);
      }
    }
  });

  it("normal strength flattening increases with distance", () => {
    const near = computeFarNormal(ridgeHeight, 500, 500, PARAMS, 1000);
    const far = computeFarNormal(ridgeHeight, 500, 500, PARAMS, 3500);
    expect(far.ny).toBeGreaterThanOrEqual(near.ny * 0.95);
  });

  it("slope is >= 0", () => {
    const result = computeFarNormal(ridgeHeight, 100, 100, PARAMS);
    expect(result.slope).toBeGreaterThanOrEqual(0);
  });

  it("returns up-normal for zero finite diff", () => {
    const result = computeFarNormal((_x, _z) => 50, 0, 0, PARAMS);
    expect(result.ny).toBeGreaterThan(0);
  });

  it("debugStrength matches params.strength when close", () => {
    const result = computeFarNormal(ridgeHeight, 100, 100, PARAMS, 500);
    expect(result.debugStrength).toBeCloseTo(PARAMS.strength, 1);
  });

  it("debugStrength decreases when far and flattening enabled", () => {
    const result = computeFarNormal(ridgeHeight, 100, 100, PARAMS, 4000);
    expect(result.debugStrength).toBeLessThan(PARAMS.strength);
  });
});
