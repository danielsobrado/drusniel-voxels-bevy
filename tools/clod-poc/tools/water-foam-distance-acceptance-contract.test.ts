import { describe, expect, it } from "vitest";
import type { WaterFoamDistanceVisualMetrics } from "./water-foam-distance-visual-metrics.js";
import { evaluateWaterFoamDistanceAcceptance } from "./water-foam-distance-acceptance-contract.js";

function metrics(
  overrides: Partial<WaterFoamDistanceVisualMetrics> = {},
): WaterFoamDistanceVisualMetrics {
  return {
    waterPixelCount: 10_000,
    nearActivePixelCount: 1_000,
    nearMeanCoverage: 0.08,
    midMeanCoverage: 0.04,
    farMeanCoverage: 0,
    midNearRatio: 0.50,
    farNearRatio: 0,
    monotonicFraction: 0.995,
    linearSampleCount: 800,
    linearMidNearRatio: 0.50,
    linearFarNearRatio: 0,
    ...overrides,
  };
}

describe("water foam distance acceptance contract", () => {
  it("accepts a configured inverse-smoothstep response", () => {
    expect(evaluateWaterFoamDistanceAcceptance(metrics()).passed).toBe(true);
  });

  it("rejects missing near evidence", () => {
    const result = evaluateWaterFoamDistanceAcceptance(metrics({
      waterPixelCount: 500,
      nearActivePixelCount: 20,
      nearMeanCoverage: 0.001,
      linearSampleCount: 10,
    }));

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/water pixels/);
    expect(result.failures.join("\n")).toMatch(/near active pixels/);
    expect(result.failures.join("\n")).toMatch(/near mean foam coverage/);
    expect(result.failures.join("\n")).toMatch(/uncapped linear samples/);
  });

  it("rejects no midpoint attenuation or excessive midpoint loss", () => {
    const noFade = evaluateWaterFoamDistanceAcceptance(metrics({
      midMeanCoverage: 0.075,
      midNearRatio: 0.94,
      linearMidNearRatio: 0.92,
    }));
    const tooDark = evaluateWaterFoamDistanceAcceptance(metrics({
      midMeanCoverage: 0.008,
      midNearRatio: 0.10,
      linearMidNearRatio: 0.08,
    }));

    expect(noFade.passed).toBe(false);
    expect(noFade.failures.join("\n")).toMatch(/mid\/near/);
    expect(tooDark.passed).toBe(false);
    expect(tooDark.failures.join("\n")).toMatch(/mid\/near/);
  });

  it("rejects foam that survives beyond the configured end distance", () => {
    const result = evaluateWaterFoamDistanceAcceptance(metrics({
      farMeanCoverage: 0.01,
      farNearRatio: 0.125,
      linearFarNearRatio: 0.12,
    }));

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/far mean foam coverage/);
    expect(result.failures.join("\n")).toMatch(/far\/near/);
  });

  it("rejects non-monotonic per-pixel response", () => {
    const result = evaluateWaterFoamDistanceAcceptance(metrics({
      monotonicFraction: 0.80,
    }));

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/monotonic water-pixel fraction/);
  });
});
