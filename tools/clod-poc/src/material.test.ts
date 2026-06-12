import type { ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import {
  applyTerrainColorAdjustments,
  DEFAULT_TERRAIN_COLOR_ADJUSTMENTS,
} from "./material.js";

describe("terrain color adjustments", () => {
  it("uses neutral defaults", () => {
    expect(DEFAULT_TERRAIN_COLOR_ADJUSTMENTS).toEqual({
      brightness: 1,
      contrast: 1,
      saturation: 1,
      warmth: 0,
    });
  });

  it("applies adjustment values to material uniforms", () => {
    const material = {
      uniforms: {
        uBrightness: { value: 1 },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
        uWarmth: { value: 0 },
      },
    } as unknown as ShaderMaterial;

    applyTerrainColorAdjustments(material, {
      brightness: 1.4,
      contrast: 0.8,
      saturation: 0.25,
      warmth: -0.5,
    });

    expect(material.uniforms.uBrightness.value).toBe(1.4);
    expect(material.uniforms.uContrast.value).toBe(0.8);
    expect(material.uniforms.uSaturation.value).toBe(0.25);
    expect(material.uniforms.uWarmth.value).toBe(-0.5);
  });
});
