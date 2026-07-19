import { describe, expect, it } from "vitest";
import type { FoamVisualAcceptanceInput } from "./water-foam-visual-contract.js";
import { evaluateWaterFoamRendererParity } from "./water-foam-renderer-parity-contract.js";

interface FixtureOverrides {
  readonly rapid?: Partial<FoamVisualAcceptanceInput["rapid"]>;
  readonly smoothRiver?: Partial<FoamVisualAcceptanceInput["smoothRiver"]>;
  readonly lakeShore?: Partial<FoamVisualAcceptanceInput["lakeShore"]>;
  readonly rapidTemporal?: Partial<FoamVisualAcceptanceInput["rapidTemporal"]>;
  readonly rapidLighting?: Partial<FoamVisualAcceptanceInput["rapidLighting"]>;
}

function fixture(overrides: FixtureOverrides = {}): FoamVisualAcceptanceInput {
  return {
    rapid: imageMetrics({ activeFraction: 0.12, meanCoverage: 0.06, ...overrides.rapid }),
    smoothRiver: imageMetrics({ activeFraction: 0.02, meanCoverage: 0.008, ...overrides.smoothRiver }),
    lakeShore: imageMetrics({ activeFraction: 0.08, meanCoverage: 0.03, ...overrides.lakeShore }),
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

describe("water foam renderer parity contract", () => {
  it("accepts a WebGL result with modest raster and shading differences", () => {
    const result = evaluateWaterFoamRendererParity(
      fixture(),
      fixture({
        rapid: {
          waterPixelCount: 9_600,
          activeFraction: 0.10,
          meanCoverage: 0.05,
          largestComponentFraction: 0.50,
          stripeAnisotropy: 0.26,
        },
        smoothRiver: { waterPixelCount: 10_400, activeFraction: 0.025 },
        lakeShore: { waterPixelCount: 9_300, meanCoverage: 0.04 },
        rapidLighting: { meanLuminance: 0.48, standardDeviation: 0.05 },
        rapidTemporal: { meanAbsoluteDelta: 0.03, binaryIou: 0.48 },
      }),
    );

    expect(result.passed).toBe(true);
  });

  it("rejects a different water mask at the same canonical pose", () => {
    const result = evaluateWaterFoamRendererParity(
      fixture(),
      fixture({ rapid: { waterPixelCount: 4_000 } }),
    );

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/rapid water-pixel ratio/);
  });

  it("rejects WebGL rapid foam that disappears or over-expands", () => {
    const missing = evaluateWaterFoamRendererParity(
      fixture(),
      fixture({ rapid: { activeFraction: 0.02, meanCoverage: 0.01 } }),
    );
    const excessive = evaluateWaterFoamRendererParity(
      fixture(),
      fixture({ rapid: { activeFraction: 0.24, meanCoverage: 0.12 } }),
    );

    expect(missing.passed).toBe(false);
    expect(missing.failures.join("\n")).toMatch(/rapid active ratio/);
    expect(excessive.passed).toBe(false);
    expect(excessive.failures.join("\n")).toMatch(/rapid active ratio/);
  });

  it("rejects renderer-specific ribbons, stripes, and smooth-river foam", () => {
    const result = evaluateWaterFoamRendererParity(
      fixture(),
      fixture({
        rapid: {
          largestComponentFraction: 0.78,
          stripeAnisotropy: 0.48,
          isolatedActiveFraction: 0.28,
        },
        smoothRiver: { activeFraction: 0.07, meanCoverage: 0.04 },
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/largest-component delta/);
    expect(result.failures.join("\n")).toMatch(/stripe delta/);
    expect(result.failures.join("\n")).toMatch(/smooth-river active excess/);
  });

  it("rejects flat lighting and unrelated temporal behavior", () => {
    const result = evaluateWaterFoamRendererParity(
      fixture(),
      fixture({
        rapidLighting: { meanLuminance: 0.82, standardDeviation: 0.01 },
        rapidTemporal: { meanAbsoluteDelta: 0.08, binaryIou: 0.10 },
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/mean luminance delta/);
    expect(result.failures.join("\n")).toMatch(/luminance-variation ratio/);
    expect(result.failures.join("\n")).toMatch(/temporal-delta ratio/);
    expect(result.failures.join("\n")).toMatch(/temporal IoU delta/);
  });
});
