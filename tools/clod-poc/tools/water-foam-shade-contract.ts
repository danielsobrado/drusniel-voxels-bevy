import type { FoamImageMetrics } from "./water-foam-visual-metrics.js";

export interface WaterFoamShadeAcceptanceInput {
  readonly lit: FoamImageMetrics;
  readonly shaded: FoamImageMetrics;
}

export interface WaterFoamShadeMeasurements {
  readonly meanCoverageRatio: number;
  readonly meanCoverageDrop: number;
  readonly activeFractionRatio: number;
}

export interface WaterFoamShadeAcceptanceResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly measurements: WaterFoamShadeMeasurements;
}

export const WATER_FOAM_SHADE_LIMITS = Object.freeze({
  minWaterPixels: 1_000,
  minLitMeanCoverage: 0.005,
  minMeanCoverageRatio: 0.35,
  maxMeanCoverageRatio: 0.82,
  minMeanCoverageDrop: 0.002,
});

export function evaluateWaterFoamShadeAcceptance(
  input: WaterFoamShadeAcceptanceInput,
): WaterFoamShadeAcceptanceResult {
  const failures: string[] = [];
  const meanCoverageRatio = input.shaded.meanCoverage / Math.max(input.lit.meanCoverage, 1e-6);
  const meanCoverageDrop = input.lit.meanCoverage - input.shaded.meanCoverage;
  const activeFractionRatio = input.shaded.activeFraction / Math.max(input.lit.activeFraction, 1e-6);
  const measurements = { meanCoverageRatio, meanCoverageDrop, activeFractionRatio };

  requireMin(failures, "lit water pixels", input.lit.waterPixelCount, WATER_FOAM_SHADE_LIMITS.minWaterPixels);
  requireMin(failures, "shaded water pixels", input.shaded.waterPixelCount, WATER_FOAM_SHADE_LIMITS.minWaterPixels);
  if (input.lit.waterPixelCount !== input.shaded.waterPixelCount) {
    failures.push(`water pixel count changed from ${input.lit.waterPixelCount} to ${input.shaded.waterPixelCount}`);
  }
  requireMin(
    failures,
    "lit mean foam coverage",
    input.lit.meanCoverage,
    WATER_FOAM_SHADE_LIMITS.minLitMeanCoverage,
  );
  requireMin(
    failures,
    "shaded/lit mean coverage ratio",
    meanCoverageRatio,
    WATER_FOAM_SHADE_LIMITS.minMeanCoverageRatio,
  );
  requireMax(
    failures,
    "shaded/lit mean coverage ratio",
    meanCoverageRatio,
    WATER_FOAM_SHADE_LIMITS.maxMeanCoverageRatio,
  );
  requireMin(
    failures,
    "lit-to-shaded mean coverage drop",
    meanCoverageDrop,
    WATER_FOAM_SHADE_LIMITS.minMeanCoverageDrop,
  );

  return { passed: failures.length === 0, failures, measurements };
}

function requireMin(failures: string[], label: string, value: number, minimum: number): void {
  if (!(value >= minimum)) failures.push(`${label} ${format(value)} is below ${format(minimum)}`);
}

function requireMax(failures: string[], label: string, value: number, maximum: number): void {
  if (!(value <= maximum)) failures.push(`${label} ${format(value)} exceeds ${format(maximum)}`);
}

function format(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : String(value);
}
