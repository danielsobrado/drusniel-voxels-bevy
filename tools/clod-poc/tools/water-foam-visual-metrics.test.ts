import { describe, expect, it } from "vitest";
import {
  deriveWaterPixelMask,
  measureFoamImage,
  measureFoamLighting,
  measureFoamTemporal,
  type PixelMask,
  type RgbaImage,
} from "./water-foam-visual-metrics.js";

const SIZE = 32;

describe("water foam visual metrics", () => {
  it("derives water pixels from controlled debug-frame differences", () => {
    const isWater = (x: number, y: number) => x >= 8 && x < 20 && y >= 10 && y < 18;
    const background: [number, number, number] = [0.18, 0.42, 0.12];
    const bodyMask = rgbImageFrom((x, y) => isWater(x, y) ? [0.8, 0.8, 0.8] : background);
    const depth = rgbImageFrom((x, y) => isWater(x, y) ? [0.2, 0.2, 0.2] : background);
    const foam = rgbImageFrom((x, y) => isWater(x, y) ? [0.0, 0.0, 0.0] : background);

    const mask = deriveWaterPixelMask(bodyMask, depth, foam);
    expect(mask.data.reduce((sum, value) => sum + value, 0)).toBe(12 * 8);
  });

  it("distinguishes coherent foam from isolated speckle", () => {
    const mask = solidMask();
    const coherent = imageFrom((x, y) => x >= 8 && x < 20 && y >= 10 && y < 18 ? 0.55 : 0);
    const speckle = imageFrom((x, y) => (x + y * 3) % 17 === 0 ? 0.8 : 0);

    const coherentMetrics = measureFoamImage(coherent, mask);
    const speckleMetrics = measureFoamImage(speckle, mask);

    expect(coherentMetrics.isolatedActiveFraction).toBe(0);
    expect(speckleMetrics.isolatedActiveFraction).toBeGreaterThan(0.8);
    expect(speckleMetrics.componentDensityPerK).toBeGreaterThan(coherentMetrics.componentDensityPerK);
  });

  it("detects a dominant continuous ribbon", () => {
    const mask = solidMask();
    const ribbon = imageFrom((_x, y) => y >= 14 && y <= 17 ? 0.7 : 0);
    const metrics = measureFoamImage(ribbon, mask);

    expect(metrics.largestComponentFraction).toBe(1);
    expect(metrics.activeFraction).toBeCloseTo(4 / SIZE);
  });

  it("measures coherent temporal movement", () => {
    const mask = solidMask();
    const first = imageFrom((x, y) => x >= 7 && x < 17 && y >= 10 && y < 18 ? 0.6 : 0);
    const second = imageFrom((x, y) => x >= 9 && x < 19 && y >= 10 && y < 18 ? 0.6 : 0);
    const temporal = measureFoamTemporal(first, second, mask);

    expect(temporal.meanAbsoluteDelta).toBeGreaterThan(0);
    expect(temporal.binaryIou).toBeGreaterThan(0.5);
    expect(temporal.binaryIou).toBeLessThan(1);
  });

  it("measures environmental lighting variation across foam", () => {
    const mask = solidMask();
    const foam = imageFrom((x, y) => x >= 6 && x < 26 && y >= 8 && y < 24 ? 0.5 : 0);
    const finalImage = imageFrom((x, y) => 0.25 + x / SIZE * 0.35 + y / SIZE * 0.1);
    const lighting = measureFoamLighting(finalImage, foam, mask);

    expect(lighting.sampleCount).toBe(20 * 16);
    expect(lighting.standardDeviation).toBeGreaterThan(0.02);
    expect(lighting.p95Luminance).toBeLessThan(0.8);
  });
});

function solidMask(): PixelMask {
  return { data: new Uint8Array(SIZE * SIZE).fill(1), width: SIZE, height: SIZE };
}

function imageFrom(sample: (x: number, y: number) => number): RgbaImage {
  return rgbImageFrom((x, y) => {
    const value = sample(x, y);
    return [value, value, value];
  });
}

function rgbImageFrom(sample: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const rgb = sample(x, y);
      const offset = (y * SIZE + x) * 4;
      data[offset] = toByte(rgb[0]);
      data[offset + 1] = toByte(rgb[1]);
      data[offset + 2] = toByte(rgb[2]);
      data[offset + 3] = 255;
    }
  }
  return { data, width: SIZE, height: SIZE, channels: 4 };
}

function toByte(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}
