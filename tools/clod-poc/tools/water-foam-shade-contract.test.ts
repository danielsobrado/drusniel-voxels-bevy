import { describe, expect, it } from "vitest";
import type { FoamImageMetrics } from "./water-foam-visual-metrics.js";
import { evaluateWaterFoamShadeAcceptance } from "./water-foam-shade-contract.js";

function metrics(overrides: Partial<FoamImageMetrics> = {}): FoamImageMetrics {
  return {
    waterPixelCount: 4_000,
    activePixelCount: 800,
    meanCoverage: 0.10,
    activeFraction: 0.20,
    isolatedActiveFraction: 0.02,
    componentDensityPerK: 5,
    largestComponentFraction: 0.30,
    stripeAnisotropy: 0.25,
    ...overrides,
  };
}

describe("water foam shade response contract", () => {
  it("accepts the configured 0.55 coverage response", () => {
    const result = evaluateWaterFoamShadeAcceptance({
      lit: metrics(),
      shaded: metrics({ meanCoverage: 0.055, activeFraction: 0.11, activePixelCount: 440 }),
    });

    expect(result.passed).toBe(true);
    expect(result.measurements.meanCoverageRatio).toBeCloseTo(0.55);
    expect(result.measurements.meanCoverageDrop).toBeCloseTo(0.045);
  });

  it("rejects a shader that ignores shade", () => {
    const result = evaluateWaterFoamShadeAcceptance({
      lit: metrics(),
      shaded: metrics({ meanCoverage: 0.099 }),
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/coverage ratio/);
    expect(result.failures.join("\n")).toMatch(/coverage drop/);
  });

  it("rejects deleting nearly all shaded whitewater", () => {
    const result = evaluateWaterFoamShadeAcceptance({
      lit: metrics(),
      shaded: metrics({ meanCoverage: 0.01, activeFraction: 0.01, activePixelCount: 40 }),
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/coverage ratio/);
  });

  it("rejects insufficient rapid evidence or a changed water mask", () => {
    const result = evaluateWaterFoamShadeAcceptance({
      lit: metrics({ waterPixelCount: 500, meanCoverage: 0.001 }),
      shaded: metrics({ waterPixelCount: 450, meanCoverage: 0.00055 }),
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/water pixels/);
    expect(result.failures.join("\n")).toMatch(/water pixel count changed/);
    expect(result.failures.join("\n")).toMatch(/lit mean foam coverage/);
  });
});
