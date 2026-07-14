import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  postFxFroxelMoistureFactor,
  projectPostFxCanopySample,
} from "./postfx_froxel_volume.js";

describe("postfx froxel forest lighting", () => {
  it("keeps dry terrain mostly clear and reserves dense fog for moisture", () => {
    expect(postFxFroxelMoistureFactor(0)).toBeCloseTo(0.25);
    expect(postFxFroxelMoistureFactor(0.5)).toBeCloseTo(0.625);
    expect(postFxFroxelMoistureFactor(1)).toBeCloseTo(1.75);
  });

  it("projects below-canopy samples toward the sun-ray crown pierce point", () => {
    const sun = new Vector3(1, 0.5, 0).normalize();
    const below = projectPostFxCanopySample(10, 20, 4, 0, sun);
    expect(below.belowCanopy).toBe(true);
    expect(below.x).toBeGreaterThan(10);
    expect(below.z).toBeCloseTo(20);

    const above = projectPostFxCanopySample(10, 20, 18, 0, sun);
    expect(above.belowCanopy).toBe(false);
    expect(above.x).toBeCloseTo(10);
    expect(above.z).toBeCloseTo(20);
  });
});
