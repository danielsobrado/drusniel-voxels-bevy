import { describe, expect, it } from "vitest";
import { validateVisualSequenceConfig } from "./schema.js";

const config = {
  schemaVersion: 1,
  id: "static-rim",
  mode: "static",
  frames: 8,
  stepSeconds: 1 / 60,
  scene: "continent",
  seed: 1,
  start: { p: [1, 2, 3], yaw: 0, pitch: 0 },
  end: { p: [1, 2, 3], yaw: 0, pitch: 0 },
  query: {},
  captureDepth: true,
};

describe("visual sequence schema", () => {
  it("accepts bounded deterministic sequence configs", () => {
    expect(validateVisualSequenceConfig(config)).toMatchObject({ id: "static-rim", frames: 8 });
  });

  it("rejects oversized captures", () => {
    expect(() => validateVisualSequenceConfig({ ...config, frames: 97 })).toThrow(/2\.\.96/);
  });

  it("rejects negative metric thresholds", () => {
    expect(() => validateVisualSequenceConfig({ ...config, thresholds: { meanLuma: -1 } })).toThrow(/non-negative/);
  });

  it("accepts rois, maskSources, and pair thresholds", () => {
    expect(validateVisualSequenceConfig({
      ...config,
      maskSources: ["sky-exclude", "roi", "ownership"],
      rois: [
        { type: "polyline", points: [[0, 10, 0], [20, 10, 0]], radiusPx: 4 },
        { type: "annulus", center: [10, 12, 10], innerRadiusPx: 8, outerRadiusPx: 20 },
      ],
      pairThresholds: { maxMeanLuma: 0.05, maxChangedRatio: 0.1 },
      thresholds: { minMaskCoverage: 0.2, maxMaskInstability: 0.01 },
      timeoutMs: 300_000,
    })).toMatchObject({ id: "static-rim", timeoutMs: 300_000 });
  });

  it("rejects unknown maskSources", () => {
    expect(() => validateVisualSequenceConfig({ ...config, maskSources: ["albedo"] })).toThrow(/maskSources/);
  });
});
