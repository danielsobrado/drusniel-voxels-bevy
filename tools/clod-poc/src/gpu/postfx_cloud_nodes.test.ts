import { describe, expect, it } from "vitest";
import cloudNodeSource from "./postfx_cloud_nodes.ts?raw";
import { compositePremultipliedCloudReference } from "./postfx_cloud_nodes.js";

describe("volumetric cloud compositing", () => {
  it("uses smooth 3D stochastic noise instead of periodic sine planes or extruded cells", () => {
    expect(cloudNodeSource).toContain("function valueNoise3");
    expect(cloudNodeSource).not.toContain("worldPosition.y.mul(0.0031)");
  });

  it("builds cloud shape from rotated multi-octave fBm with stable march jitter", () => {
    expect(cloudNodeSource).toContain("function fbm3");
    expect(cloudNodeSource).toContain("rotateOctaveDomain");
    expect(cloudNodeSource).toContain("rotateErosionDomain");
    expect(cloudNodeSource).not.toContain("time.mul(0.037)");
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
