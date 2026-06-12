import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENT_SETTINGS, sunDirectionFromAngles } from "./environment.js";

describe("sunDirectionFromAngles", () => {
  it("returns a normalized vector at the horizon", () => {
    expect(sunDirectionFromAngles(0, 0).length()).toBeCloseTo(1);
  });

  it("points mostly up at 90 degrees elevation", () => {
    const direction = sunDirectionFromAngles(0, 90);
    expect(direction.y).toBeGreaterThan(0.999);
  });
});

describe("DEFAULT_ENVIRONMENT_SETTINGS", () => {
  it("uses positive lighting intensities and exposure", () => {
    expect(DEFAULT_ENVIRONMENT_SETTINGS.sunIntensity).toBeGreaterThan(0);
    expect(DEFAULT_ENVIRONMENT_SETTINGS.skyIntensity).toBeGreaterThan(0);
    expect(DEFAULT_ENVIRONMENT_SETTINGS.groundIntensity).toBeGreaterThan(0);
    expect(DEFAULT_ENVIRONMENT_SETTINGS.sunDiskIntensity).toBeGreaterThan(0);
    expect(DEFAULT_ENVIRONMENT_SETTINGS.sunGlowIntensity).toBeGreaterThan(0);
    expect(DEFAULT_ENVIRONMENT_SETTINGS.hazeIntensity).toBeGreaterThan(0);
    expect(DEFAULT_ENVIRONMENT_SETTINGS.exposure).toBeGreaterThan(0);
  });
});
