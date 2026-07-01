import { describe, expect, it } from "vitest";
import { DEFAULT_POSTFX_ATMOSPHERE } from "./postfx_atmosphere.js";
import { POSTFX_HILLAIRE_LUT_SIZES, PostFxHillaireLuts } from "./postfx_hillaire_luts.js";

describe("postfx Hillaire LUTs", () => {
  it("builds transmittance, multi-scatter, and sky-view textures at target sizes", () => {
    const luts = new PostFxHillaireLuts(DEFAULT_POSTFX_ATMOSPHERE.hillaire);
    expect(luts.transmittanceTexture.image.width).toBe(POSTFX_HILLAIRE_LUT_SIZES.transmittance.width);
    expect(luts.transmittanceTexture.image.height).toBe(POSTFX_HILLAIRE_LUT_SIZES.transmittance.height);
    expect(luts.multiScatterTexture.image.width).toBe(POSTFX_HILLAIRE_LUT_SIZES.multiScatter.width);
    expect(luts.multiScatterTexture.image.height).toBe(POSTFX_HILLAIRE_LUT_SIZES.multiScatter.height);
    expect(luts.skyViewTexture.image.width).toBe(POSTFX_HILLAIRE_LUT_SIZES.skyView.width);
    expect(luts.skyViewTexture.image.height).toBe(POSTFX_HILLAIRE_LUT_SIZES.skyView.height);
    luts.dispose();
  });

  it("stores finite normalized LUT values", () => {
    const luts = new PostFxHillaireLuts(DEFAULT_POSTFX_ATMOSPHERE.hillaire);
    for (const texture of [luts.transmittanceTexture, luts.multiScatterTexture, luts.skyViewTexture]) {
      const data = texture.image.data as Float32Array;
      expect(data.length).toBeGreaterThan(0);
      for (let i = 0; i < data.length; i += Math.max(1, Math.floor(data.length / 16))) {
        expect(Number.isFinite(data[i])).toBe(true);
        expect(data[i]).toBeGreaterThanOrEqual(0);
        expect(data[i]).toBeLessThanOrEqual(1);
      }
    }
    luts.dispose();
  });
});
