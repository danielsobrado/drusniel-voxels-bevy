import type { WaterFoamDistanceVisualMetrics } from "./water-foam-distance-visual-metrics.js";

export const WATER_FOAM_DISTANCE_ACCEPTANCE_LIMITS = Object.freeze({
  minWaterPixels: 1_000,
  minNearActivePixels: 100,
  minNearMeanCoverage: 0.005,
  minMidNearRatio: 0.25,
  maxMidNearRatio: 0.75,
  maxFarMeanCoverage: 0.003,
  maxFarNearRatio: 0.05,
  minMonotonicFraction: 0.95,
  minLinearSamples: 100,
  minLinearMidNearRatio: 0.35,
  maxLinearMidNearRatio: 0.65,
  maxLinearFarNearRatio: 0.05,
});

export interface WaterFoamDistanceAcceptanceResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly metrics: WaterFoamDistanceVisualMetrics;
}

export function evaluateWaterFoamDistanceAcceptance(
  metrics: WaterFoamDistanceVisualMetrics,
): WaterFoamDistanceAcceptanceResult {
  const limits = WATER_FOAM_DISTANCE_ACCEPTANCE_LIMITS;
  const failures: string[] = [];

  requireMin(failures, "water pixels", metrics.waterPixelCount, limits.minWaterPixels);
  requireMin(failures, "near active pixels", metrics.nearActivePixelCount, limits.minNearActivePixels);
  requireMin(failures, "near mean foam coverage", metrics.nearMeanCoverage, limits.minNearMeanCoverage);
  requireRange(
    failures,
    "mid/near mean coverage ratio",
    metrics.midNearRatio,
    limits.minMidNearRatio,
    limits.maxMidNearRatio,
  );
  requireMax(failures, "far mean foam coverage", metrics.farMeanCoverage, limits.maxFarMeanCoverage);
  requireMax(failures, "far/near mean coverage ratio", metrics.farNearRatio, limits.maxFarNearRatio);
  requireMin(
    failures,
    "monotonic water-pixel fraction",
    metrics.monotonicFraction,
    limits.minMonotonicFraction,
  );
  requireMin(failures, "uncapped linear samples", metrics.linearSampleCount, limits.minLinearSamples);
  requireRange(
    failures,
    "uncapped mid/near coverage ratio",
    metrics.linearMidNearRatio,
    limits.minLinearMidNearRatio,
    limits.maxLinearMidNearRatio,
  );
  requireMax(
    failures,
    "uncapped far/near coverage ratio",
    metrics.linearFarNearRatio,
    limits.maxLinearFarNearRatio,
  );

  return { passed: failures.length === 0, failures, metrics };
}

function requireMin(failures: string[], label: string, value: number, minimum: number): void {
  if (!Number.isFinite(value) || value < minimum) {
    failures.push(`${label} ${format(value)} is below ${format(minimum)}`);
  }
}

function requireMax(failures: string[], label: string, value: number, maximum: number): void {
  if (!Number.isFinite(value) || value > maximum) {
    failures.push(`${label} ${format(value)} exceeds ${format(maximum)}`);
  }
}

function requireRange(
  failures: string[],
  label: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  requireMin(failures, label, value, minimum);
  requireMax(failures, label, value, maximum);
}

function format(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "non-finite";
}
