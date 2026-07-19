import { describe, expect, it } from "vitest";
import cloudNodeSource from "./postfx_cloud_nodes.ts?raw";
import { compositePremultipliedCloudReference } from "./postfx_cloud_nodes.js";

describe("volumetric cloud compositing", () => {
  it("uses warped multi-octave 3D noise instead of an exposed value-noise lattice", () => {
    expect(cloudNodeSource).toContain("function valueNoise3");
    expect(cloudNodeSource).toContain("function cloudNoiseField");
    expect(cloudNodeSource).toContain("CLOUD_DOMAIN_WARP_STRENGTH");
    expect(cloudNodeSource).toContain("CLOUD_OCTAVE_1_FREQUENCY");
    expect(cloudNodeSource).toContain("CLOUD_OCTAVE_2_FREQUENCY");
    expect(cloudNodeSource).not.toContain("worldPosition.y.mul(0.0031)");
  });

  it("keeps ray-start jitter stable instead of sliding the sampling grid every frame", () => {
    expect(cloudNodeSource).toContain("screenUV.mul(vec2(CLOUD_BLUE_NOISE_SCALE[0], CLOUD_BLUE_NOISE_SCALE[1]))");
    expect(cloudNodeSource).not.toContain("time.mul(0.037)");
    expect(cloudNodeSource).not.toContain("time.mul(0.019)");
  });

  it("adds premultiplied cloud radiance without multiplying alpha twice", () => {
    const result = compositePremultipliedCloudReference(
      [0.2, 0.4, 0.6],
      [0.3, 0.2, 0.1],
      0.5,
    );

    expect(result).toEqual([0.4, 0.4, 0.4]);
  });

  it("clamps opacity while preserving the accumulated cloud radiance", () => {
    expect(compositePremultipliedCloudReference([1, 1, 1], [0.2, 0.3, 0.4], 2))
      .toEqual([0.2, 0.3, 0.4]);
    expect(compositePremultipliedCloudReference([1, 1, 1], [0, 0, 0], -1))
      .toEqual([1, 1, 1]);
  });
});
