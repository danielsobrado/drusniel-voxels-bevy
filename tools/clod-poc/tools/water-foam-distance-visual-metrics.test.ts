import { describe, expect, it } from "vitest";
import type { PixelMask, RgbaImage } from "./water-foam-visual-metrics.js";
import { measureWaterFoamDistanceResponse } from "./water-foam-distance-visual-metrics.js";

function grayscale(values: readonly number[], width = values.length): RgbaImage {
  const data = new Uint8Array(values.length * 4);
  values.forEach((value, pixel) => {
    const channel = Math.round(Math.min(1, Math.max(0, value)) * 255);
    const offset = pixel * 4;
    data[offset] = channel;
    data[offset + 1] = channel;
    data[offset + 2] = channel;
    data[offset + 3] = 255;
  });
  return { data, width, height: values.length / width, channels: 4 };
}

function mask(values: readonly number[], width = values.length): PixelMask {
  return {
    data: Uint8Array.from(values),
    width,
    height: values.length / width,
  };
}

describe("water foam distance visual metrics", () => {
  it("measures an ideal full, half, and zero response", () => {
    const result = measureWaterFoamDistanceResponse(
      grayscale([0.10, 0.20, 0.40, 0.50]),
      grayscale([0.05, 0.10, 0.20, 0.25]),
      grayscale([0, 0, 0, 0]),
      mask([1, 1, 1, 1]),
    );

    expect(result.waterPixelCount).toBe(4);
    expect(result.nearActivePixelCount).toBe(4);
    expect(result.midNearRatio).toBeCloseTo(0.5, 1);
    expect(result.farNearRatio).toBe(0);
    expect(result.monotonicFraction).toBe(1);
    expect(result.linearSampleCount).toBe(3);
    expect(result.linearMidNearRatio).toBeCloseTo(0.5, 1);
    expect(result.linearFarNearRatio).toBe(0);
  });

  it("uses only water pixels and excludes capped near samples from the linear ratio", () => {
    const result = measureWaterFoamDistanceResponse(
      grayscale([0.20, 0.52, 0.30, 0.40]),
      grayscale([0.10, 0.40, 0.15, 0.20]),
      grayscale([0, 0, 0, 0]),
      mask([1, 1, 0, 1]),
    );

    expect(result.waterPixelCount).toBe(3);
    expect(result.linearSampleCount).toBe(2);
    expect(result.linearMidNearRatio).toBeCloseTo(0.5, 1);
  });

  it("detects non-monotonic pixel response", () => {
    const result = measureWaterFoamDistanceResponse(
      grayscale([0.20, 0.20, 0.20, 0.20]),
      grayscale([0.10, 0.30, 0.10, 0.30]),
      grayscale([0, 0, 0.20, 0]),
      mask([1, 1, 1, 1]),
    );

    expect(result.monotonicFraction).toBe(0.25);
  });

  it("rejects incompatible image and mask dimensions", () => {
    expect(() => measureWaterFoamDistanceResponse(
      grayscale([0.1, 0.2]),
      grayscale([0.1], 1),
      grayscale([0, 0]),
      mask([1, 1]),
    )).toThrow(/image dimensions differ/);

    expect(() => measureWaterFoamDistanceResponse(
      grayscale([0.1, 0.2]),
      grayscale([0.1, 0.2]),
      grayscale([0, 0]),
      mask([1]),
    )).toThrow(/image and mask dimensions differ/);
  });
});
