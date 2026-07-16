import { describe, expect, it } from "vitest";
import {
  colorMarkerCentroid,
  luminanceEdgeDrift,
  temporalSecondDifference,
  type RawRgbImage,
} from "./precision_image_signals.js";

function image(width: number, height: number, fill = 0): RawRgbImage {
  return { data: new Uint8Array(width * height * 3).fill(fill), width, height, channels: 3 };
}

function pixel(target: RawRgbImage, x: number, y: number, rgb: readonly [number, number, number]): void {
  const offset = (y * target.width + x) * target.channels;
  target.data.set(rgb, offset);
}

describe("precision image signals", () => {
  it("finds deterministic diagnostic marker centroids", () => {
    const source = image(4, 3);
    pixel(source, 1, 1, [255, 0, 255]);
    pixel(source, 3, 1, [255, 0, 255]);
    pixel(source, 2, 2, [0, 255, 255]);
    expect(colorMarkerCentroid(source, "magenta")).toMatchObject({ pixelCount: 2, xPx: 2, yPx: 1 });
    expect(colorMarkerCentroid(source, "cyan")).toMatchObject({ pixelCount: 1, xPx: 2, yPx: 2 });
  });

  it("reports zero edge drift for identical frozen frames and movement for a shifted edge", () => {
    const first = image(5, 5);
    const second = image(5, 5);
    for (let y = 0; y < 5; y++) {
      for (let x = 2; x < 5; x++) pixel(first, x, y, [255, 255, 255]);
      for (let x = 3; x < 5; x++) pixel(second, x, y, [255, 255, 255]);
    }
    expect(luminanceEdgeDrift(first, first).changedEdgePixels).toBe(0);
    expect(luminanceEdgeDrift(first, second).changedEdgePixels).toBeGreaterThan(0);
  });

  it("uses temporal second differences to reject non-linear crawl while linear motion cancels", () => {
    const first = image(1, 1, 10);
    const middle = image(1, 1, 20);
    const last = image(1, 1, 30);
    expect(temporalSecondDifference(first, middle, last).changedPixels).toBe(0);
    last.data.fill(50);
    expect(temporalSecondDifference(first, middle, last).maxChannelResidual).toBe(20);
  });
});
