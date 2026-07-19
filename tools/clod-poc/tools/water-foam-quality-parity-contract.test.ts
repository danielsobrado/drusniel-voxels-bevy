import { describe, expect, it } from "vitest";
import type { FoamVisualAcceptanceInput } from "./water-foam-visual-contract.js";
import { evaluateWaterFoamQualityParity } from "./water-foam-quality-parity-contract.js";

function fixture(
  overrides: {
    readonly rapid?: Partial<FoamVisualAcceptanceInput["rapid"]>;
    readonly rapidTemporal?: Partial<FoamVisualAcceptanceInput["rapidTemporal"]>;
    readonly rapidLighting?: Partial<FoamVisualAcceptanceInput["rapidLighting"]>;
  } = {},
): FoamVisualAcceptanceInput {
  return {
    rapid: imageMetrics({ activeFraction: 0.12, meanCoverage: 0.06, ...overrides.rapid }),
    smoothRiver: imageMetrics({ activeFraction: 0.02, meanCoverage: 0.008 }),
    lakeShore: imageMetrics({ activeFraction: 0.08, meanCoverage: 0.03 }),
    rapidTemporal: {
      comparedPixelCount: 10_000,
      meanAbsoluteDelta: 0.02,
      binaryIou: 0.60,
      ...overrides.rapidTemporal,
    },
    rapidLighting: {
      sampleCount: 1_000,
      meanLuminance: 0.55,
      p95Luminance: 0.82,
      standardDeviation: 0.08,
      ...overrides.rapidLighting,
    },
  };
}

function imageMetrics(
  overrides: Partial<FoamVisualAcceptanceInput["rapid"]> = {},
): FoamVisualAcceptanceInput["rapid"] {
  return {
    waterPixelCount: 10_000,
    activePixelCount: 1_000,
    meanCoverage: 0.05,
    activeFraction: 0.10,
    isolatedActiveFraction: 0.04,
    componentDensityPerK: 12,
    largestComponentFraction: 0.42,
    stripeAnisotropy: 0.20,
    ...overrides,
  };
}

describe("water foam quality parity contract", () => {
  it("passes a lower-cost tier that preserves HQ structure", () => {
    const result = evaluateWaterFoamQualityParity(
      fixture(),
      fixture({
        rapid: { activeFraction: 0.08, meanCoverage: 0.035 },
        rapidLighting: { meanLuminance: 0.50, standardDeviation: 0.05 },
      }),
    );

    expect(result.passed).toBe(true);
  });

  it("rejects performance foam that nearly disappears", () => {
    const result = evaluateWaterFoamQualityParity(
      fixture(),
      fixture({ rapid: { activeFraction: 0.02, meanCoverage: 0.01 } }),
    );

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/rapid active ratio/);
  });

  it("rejects performance-only ribbons and stripes", () => {
    const result = evaluateWaterFoamQualityParity(
      fixture(),
      fixture({ rapid: { largestComponentFraction: 0.80, stripeAnisotropy: 0.50 } }),
    );

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/largest-component delta/);
    expect(result.failures.join("\n")).toMatch(/stripe delta/);
  });

  it("rejects flat lighting and unrelated temporal behavior", () => {
    const result = evaluateWaterFoamQualityParity(
      fixture(),
      fixture({
        rapidLighting: { standardDeviation: 0.01 },
        rapidTemporal: { meanAbsoluteDelta: 0.08, binaryIou: 0.20 },
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/luminance-variation ratio/);
    expect(result.failures.join("\n")).toMatch(/temporal-delta ratio/);
  });
});
