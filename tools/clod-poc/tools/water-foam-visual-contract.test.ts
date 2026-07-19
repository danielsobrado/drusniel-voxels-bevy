import { describe, expect, it } from "vitest";
import { evaluateFoamVisualAcceptance, type FoamVisualAcceptanceInput } from "./water-foam-visual-contract.js";

const PASSING: FoamVisualAcceptanceInput = {
  rapid: {
    waterPixelCount: 100_000,
    activePixelCount: 12_000,
    meanCoverage: 0.055,
    activeFraction: 0.12,
    isolatedActiveFraction: 0.04,
    componentDensityPerK: 4,
    largestComponentFraction: 0.32,
    stripeAnisotropy: 0.34,
  },
  smoothRiver: {
    waterPixelCount: 100_000,
    activePixelCount: 2_000,
    meanCoverage: 0.012,
    activeFraction: 0.02,
    isolatedActiveFraction: 0.03,
    componentDensityPerK: 2,
    largestComponentFraction: 0.25,
    stripeAnisotropy: 0.3,
  },
  lakeShore: {
    waterPixelCount: 100_000,
    activePixelCount: 5_000,
    meanCoverage: 0.025,
    activeFraction: 0.05,
    isolatedActiveFraction: 0.03,
    componentDensityPerK: 2,
    largestComponentFraction: 0.3,
    stripeAnisotropy: 0.3,
  },
  rapidTemporal: {
    comparedPixelCount: 100_000,
    meanAbsoluteDelta: 0.018,
    binaryIou: 0.68,
  },
  rapidLighting: {
    sampleCount: 10_000,
    meanLuminance: 0.58,
    p95Luminance: 0.83,
    standardDeviation: 0.09,
  },
};

describe("water foam visual acceptance contract", () => {
  it("accepts sparse coherent environmentally lit whitewater", () => {
    expect(evaluateFoamVisualAcceptance(PASSING)).toEqual({ passed: true, failures: [] });
  });

  it("rejects the broad continuous white ribbon failure", () => {
    const result = evaluateFoamVisualAcceptance({
      ...PASSING,
      rapid: {
        ...PASSING.rapid,
        activeFraction: 0.48,
        meanCoverage: 0.31,
        largestComponentFraction: 0.96,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toContain("rapid active fraction");
    expect(result.failures.join("\n")).toContain("rapid largest component fraction");
  });

  it("rejects static and flat-white foam", () => {
    const result = evaluateFoamVisualAcceptance({
      ...PASSING,
      rapidTemporal: {
        ...PASSING.rapidTemporal,
        meanAbsoluteDelta: 0,
        binaryIou: 1,
      },
      rapidLighting: {
        ...PASSING.rapidLighting,
        meanLuminance: 0.97,
        p95Luminance: 1,
        standardDeviation: 0.001,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toContain("rapid temporal delta");
    expect(result.failures.join("\n")).toContain("rapid lit foam p95 luminance");
    expect(result.failures.join("\n")).toContain("rapid lit foam luminance variation");
  });

  it("rejects foam on smooth fast water", () => {
    const result = evaluateFoamVisualAcceptance({
      ...PASSING,
      smoothRiver: {
        ...PASSING.smoothRiver,
        activeFraction: 0.16,
        meanCoverage: 0.09,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toContain("smooth river active fraction");
    expect(result.failures.join("\n")).toContain("rapid/smooth active ratio");
  });
});
