import { describe, expect, it } from "vitest";
import {
  detectTreeImpostorDarkSpikes,
} from "./index.js";

describe("tree impostor dark spike detector", () => {
  it("fails on isolated tall black vertical shards", () => {
    const image = solidImage(64, 96, 96);
    drawRect(image, 64, 31, 12, 1, 70, 0);

    const report = detectTreeImpostorDarkSpikes({
      width: 64,
      height: 96,
      rgba: image,
      thresholds: { maxSpikeRuns: 0, maxSpikePixelRatio: 0 },
    });

    expect(report.status).toBe("fail");
    expect(report.spikeRuns.length).toBeGreaterThan(0);
    expect(report.spikePixelRatio).toBeGreaterThan(0);
  });

  it("does not flag broad dark silhouettes as thin spike shards", () => {
    const image = solidImage(64, 96, 96);
    drawRect(image, 64, 26, 12, 10, 70, 0);

    const report = detectTreeImpostorDarkSpikes({
      width: 64,
      height: 96,
      rgba: image,
      thresholds: { maxSpikeRuns: 0, maxSpikePixelRatio: 0 },
    });

    expect(report.status).toBe("pass");
    expect(report.spikeRuns).toHaveLength(0);
  });

  it("does not flag short dark details", () => {
    const image = solidImage(64, 96, 96);
    drawRect(image, 64, 31, 40, 1, 12, 0);

    const report = detectTreeImpostorDarkSpikes({
      width: 64,
      height: 96,
      rgba: image,
      thresholds: { maxSpikeRuns: 0, maxSpikePixelRatio: 0 },
    });

    expect(report.status).toBe("pass");
  });
});

function solidImage(width: number, height: number, value: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    out[offset] = value;
    out[offset + 1] = value;
    out[offset + 2] = value;
    out[offset + 3] = 255;
  }
  return out;
}

function drawRect(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const offset = (yy * width + xx) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
}
