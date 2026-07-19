import type { FoamVisualAcceptanceInput } from "./water-foam-visual-contract.js";

export interface WaterFoamQualityParityResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly measurements: Readonly<Record<string, number>>;
}

export const WATER_FOAM_QUALITY_PARITY_LIMITS = Object.freeze({
  rapidActiveRatioMin: 0.45,
  rapidActiveRatioMax: 1.20,
  rapidMeanCoverageRatioMin: 0.35,
  rapidMeanCoverageRatioMax: 1.25,
  rapidLargestComponentDeltaMax: 0.18,
  rapidStripeDeltaMax: 0.15,
  rapidIsolatedDeltaMax: 0.15,
  smoothRiverActiveExcessMax: 0.025,
  smoothRiverCoverageExcessMax: 0.015,
  lakeShoreCoverageDeltaMax: 0.035,
  lightingMeanDeltaMax: 0.15,
  lightingVariationRatioMin: 0.35,
  temporalDeltaRatioMin: 0.35,
  temporalDeltaRatioMax: 1.80,
  temporalIouDeltaMax: 0.30,
});

export function evaluateWaterFoamQualityParity(
  high: FoamVisualAcceptanceInput,
  low: FoamVisualAcceptanceInput,
): WaterFoamQualityParityResult {
  const limits = WATER_FOAM_QUALITY_PARITY_LIMITS;
  const measurements = {
    rapidActiveRatio: ratio(low.rapid.activeFraction, high.rapid.activeFraction),
    rapidMeanCoverageRatio: ratio(low.rapid.meanCoverage, high.rapid.meanCoverage),
    rapidLargestComponentDelta: delta(low.rapid.largestComponentFraction, high.rapid.largestComponentFraction),
    rapidStripeDelta: delta(low.rapid.stripeAnisotropy, high.rapid.stripeAnisotropy),
    rapidIsolatedDelta: delta(low.rapid.isolatedActiveFraction, high.rapid.isolatedActiveFraction),
    smoothRiverActiveExcess: low.smoothRiver.activeFraction - high.smoothRiver.activeFraction,
    smoothRiverCoverageExcess: low.smoothRiver.meanCoverage - high.smoothRiver.meanCoverage,
    lakeShoreCoverageDelta: delta(low.lakeShore.meanCoverage, high.lakeShore.meanCoverage),
    lightingMeanDelta: delta(low.rapidLighting.meanLuminance, high.rapidLighting.meanLuminance),
    lightingVariationRatio: ratio(low.rapidLighting.standardDeviation, high.rapidLighting.standardDeviation),
    temporalDeltaRatio: ratio(low.rapidTemporal.meanAbsoluteDelta, high.rapidTemporal.meanAbsoluteDelta),
    temporalIouDelta: delta(low.rapidTemporal.binaryIou, high.rapidTemporal.binaryIou),
  };
  const failures: string[] = [];

  requireRange(failures, "rapid active ratio low/high", measurements.rapidActiveRatio, limits.rapidActiveRatioMin, limits.rapidActiveRatioMax);
  requireRange(failures, "rapid mean coverage ratio low/high", measurements.rapidMeanCoverageRatio, limits.rapidMeanCoverageRatioMin, limits.rapidMeanCoverageRatioMax);
  requireMax(failures, "rapid largest-component delta", measurements.rapidLargestComponentDelta, limits.rapidLargestComponentDeltaMax);
  requireMax(failures, "rapid stripe delta", measurements.rapidStripeDelta, limits.rapidStripeDeltaMax);
  requireMax(failures, "rapid isolated delta", measurements.rapidIsolatedDelta, limits.rapidIsolatedDeltaMax);
  requireMax(failures, "smooth-river active excess", measurements.smoothRiverActiveExcess, limits.smoothRiverActiveExcessMax);
  requireMax(failures, "smooth-river coverage excess", measurements.smoothRiverCoverageExcess, limits.smoothRiverCoverageExcessMax);
  requireMax(failures, "lake-shore coverage delta", measurements.lakeShoreCoverageDelta, limits.lakeShoreCoverageDeltaMax);
  requireMax(failures, "lit-foam mean luminance delta", measurements.lightingMeanDelta, limits.lightingMeanDeltaMax);
  requireMin(failures, "lit-foam luminance-variation ratio low/high", measurements.lightingVariationRatio, limits.lightingVariationRatioMin);
  requireRange(failures, "rapid temporal-delta ratio low/high", measurements.temporalDeltaRatio, limits.temporalDeltaRatioMin, limits.temporalDeltaRatioMax);
  requireMax(failures, "rapid temporal IoU delta", measurements.temporalIouDelta, limits.temporalIouDeltaMax);

  return { passed: failures.length === 0, failures, measurements };
}

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return Number.NaN;
  return numerator / Math.max(Math.abs(denominator), 1e-6);
}

function delta(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.abs(a - b);
}

function requireMin(failures: string[], label: string, value: number, min: number): void {
  if (!Number.isFinite(value) || value < min) failures.push(`${label} ${format(value)} is below ${min.toFixed(4)}`);
}

function requireMax(failures: string[], label: string, value: number, max: number): void {
  if (!Number.isFinite(value) || value > max) failures.push(`${label} ${format(value)} exceeds ${max.toFixed(4)}`);
}

function requireRange(failures: string[], label: string, value: number, min: number, max: number): void {
  requireMin(failures, label, value, min);
  requireMax(failures, label, value, max);
}

function format(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "non-finite";
}
