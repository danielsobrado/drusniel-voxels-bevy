import { describe, expect, it } from "vitest";
import {
  measureFoamImage,
  measureFoamLighting,
  measureFoamTemporal,
  type RgbaImage,
} from "./water-foam-visual-metrics.js";

const SIZE = 32;

describe("water foam visual metrics", () => {
  it("distinguishes coherent foam from isolated speckle", () => {
    const mask = solidImage(1);
    const coherent = imageFrom((x, y) => x >= 8 && x < 20 && y >= 10 && y < 18 ? 0.55 : 0);
    const speckle = imageFrom((x, y) => (x + y * 3) % 17 === 0 ? 0.8 : 0);

    const coherentMetrics = measureFoamImage(coherent, mask);
    const speckleMetrics = measureFoamImage(speckle, mask);

    expect(coherentMetrics.isolatedActiveFraction).toBe(0);
    expect(speckleMetrics.isolatedActiveFraction).toBeGreaterThan(0.8);
    expect(speckleMetrics.componentDensityPerK).toBeGreaterThan(coherentMetrics.componentDensityPerK);
  });

  it("detects a dominant continuous ribbon", () => {
    const mask = solidImage(1);
    const ribbon = imageFrom((_x, y) => y >= 14 && y <= 17 ? 0.7 : 0);
    const metrics = measureFoamImage(ribbon, mask);

    expect(metrics.largestComponentFraction).toBe(1);
    expect(metrics.activeFraction).toBeCloseTo(4 / SIZE);
  });

  it("measures coherent temporal movement", () => {
    const mask = solidImage(1);
    const first = imageFrom((x, y) => x >= 7 && x < 17 && y >= 10 && y < 18 ? 0.6 : 0);
    const second = imageFrom((x, y) => x >= 9 && x < 19 && y >= 10 && y < 18 ? 0.6 : 0);
    const temporal = measureFoamTemporal(first, second, mask);

    expect(temporal.meanAbsoluteDelta).toBeGreaterThan(0);
    expect(temporal.binaryIou).toBeGreaterThan(0.5);
    expect(temporal.binaryIou).toBeLessThan(1);
  });

  it("measures environmental lighting variation across foam", () => {
    const mask = solidImage(1);
    const foam = imageFrom((x, y) => x >= 6 && x < 26 && y >= 8 && y < 24 ? 0.5 : 0);
    const finalImage = imageFrom((x, y) => 0.25 + x / SIZE * 0.35 + y / SIZE * 0.1);
    const lighting = measureFoamLighting(finalImage, foam, mask);

    expect(lighting.sampleCount).toBe(20 * 16);
    expect(lighting.standardDeviation).toBeGreaterThan(0.02);
    expect(lighting.p95Luminance).toBeLessThan(0.8);
  });
});

function solidImage(value: number): RgbaImage {
  return imageFrom(() => value);
}

function imageFrom(sample: (x: number, y: number) => number): RgbaImage {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const value = Math.round(Math.max(0, Math.min(1, sample(x, y))) * 255);
      const offset = (y * SIZE + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width: SIZE, height: SIZE, channels: 4 };
}
