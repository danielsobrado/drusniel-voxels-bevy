import { describe, expect, it } from "vitest";
import { detectPopComponents, residualMetrics, temporalMetrics, type ImagePlane } from "./metrics.js";
import { reprojectedResidual } from "./reprojection.js";
import { rasterizeAnnulusRoi, rasterizePolylineRoi } from "./roi.js";

const WIDTH = 8;
const HEIGHT = 8;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

function plane(fill = 0): ImagePlane {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let p = 0; p < WIDTH * HEIGHT; p++) data.set([fill, fill, fill, 255], p * 4);
  return { width: WIDTH, height: HEIGHT, data, channels: 4 };
}

function paint(source: ImagePlane, predicate: (x: number, y: number) => boolean, value: number): ImagePlane {
  const result = { ...source, data: new Uint8Array(source.data) };
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (predicate(x, y)) {
    const offset = (y * WIDTH + x) * 4;
    result.data.set([value, value, value, 255], offset);
  }
  return result;
}

describe("visual sequence metric defect fixtures", () => {
  it("detects static noise", () => {
    const noisy = paint(plane(), (x, y) => (x + y) % 3 === 0, 3);
    expect(residualMetrics(plane(), noisy).meanLuma).toBeGreaterThan(0);
  });

  it("detects a single-frame flash", () => {
    const frames = [plane(), plane(255), plane()];
    expect(temporalMetrics(frames).maxChangedRatio).toBe(1);
  });

  it("records both edges of a two-frame flash", () => {
    const frames = [plane(), plane(180), plane(180), plane()];
    expect(temporalMetrics(frames).adjacent.filter((frame) => frame.meanLuma > 0.5)).toHaveLength(2);
  });

  it("bounds a large contiguous pop", () => {
    const changed = paint(plane(), (x, y) => x >= 2 && x <= 5 && y >= 1 && y <= 6, 255);
    expect(detectPopComponents(plane(), changed, 1, 0.1)[0]).toMatchObject({ x: 2, y: 1, width: 4, height: 6, area: 24 });
  });

  it("retains a thin seam as a connected event", () => {
    const seam = paint(plane(), (x) => x === 4, 255);
    expect(detectPopComponents(plane(), seam, 1, 0.1)[0]).toMatchObject({ width: 1, height: 8, area: 8 });
  });

  it("orders gradual drift below an abrupt flash", () => {
    const drift = temporalMetrics([plane(), plane(8), plane(16), plane(24)]);
    const flash = temporalMetrics([plane(), plane(255), plane()]);
    expect(drift.maxP95Luma).toBeLessThan(flash.maxP95Luma);
  });

  it("detects alternating checkerboard edge instability", () => {
    const a = paint(plane(), (x, y) => (x + y) % 2 === 0, 255);
    const b = paint(plane(), (x, y) => (x + y) % 2 !== 0, 255);
    expect(residualMetrics(a, b).changedRatio).toBe(1);
  });

  it("classifies a whole-frame exposure pulse", () => {
    expect(residualMetrics(plane(80), plane(160))).toMatchObject({ changedRatio: 1 });
  });

  it("does not confuse expected translation with paired instability", () => {
    const translated = paint(plane(), (x) => x >= 2 && x <= 4, 255);
    expect(residualMetrics(plane(), translated).changedRatio).toBeGreaterThan(0);
    expect(residualMetrics(translated, translated).meanLuma).toBe(0);
  });

  it("gives zero residual to reprojected-stable motion", () => {
    const color = paint(plane(20), (x, y) => x === y, 180);
    const depth = new Float32Array(WIDTH * HEIGHT).fill(0.5);
    const result = reprojectedResidual({
      previousColor: color,
      currentColor: color,
      previousDepth: depth,
      currentDepth: depth,
      previousViewProjection: IDENTITY,
      currentViewProjectionInverse: IDENTITY,
    });
    expect(result.validRatio).toBe(1);
    expect(result.residual.meanLuma).toBe(0);
  });

  it("detects reprojected-unstable motion", () => {
    const depth = new Float32Array(WIDTH * HEIGHT).fill(0.5);
    const result = reprojectedResidual({
      previousColor: plane(20),
      currentColor: plane(100),
      previousDepth: depth,
      currentDepth: depth,
      previousViewProjection: IDENTITY,
      currentViewProjectionInverse: IDENTITY,
    });
    expect(result.residual.meanLuma).toBeGreaterThan(0.25);
  });
});

describe("visual sequence projected ROI primitives", () => {
  it("preserves thin seam bands", () => {
    const mask = rasterizePolylineRoi(8, 8, [{ x: 4, y: 0 }, { x: 4, y: 8 }], 0.6);
    expect(mask.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(8);
  });

  it("rasterizes an impostor transition annulus", () => {
    const mask = rasterizeAnnulusRoi(16, 16, { x: 8, y: 8 }, 3, 5);
    const active = mask.reduce((sum, value) => sum + value, 0);
    expect(active).toBeGreaterThan(20);
    expect(active).toBeLessThan(100);
  });
});
