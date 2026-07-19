import type {
  FoamImageMetrics,
  FoamLightingMetrics,
  FoamTemporalMetrics,
} from "./water-foam-visual-metrics.js";

export interface FoamVisualAcceptanceInput {
  readonly rapid: FoamImageMetrics;
  readonly smoothRiver: FoamImageMetrics;
  readonly lakeShore: FoamImageMetrics;
  readonly rapidTemporal: FoamTemporalMetrics;
  readonly rapidLighting: FoamLightingMetrics;
}

export interface FoamVisualAcceptanceResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export const WATER_FOAM_VISUAL_LIMITS = Object.freeze({
  minWaterPixels: 1_000,
  rapidActiveFractionMin: 0.005,
  rapidActiveFractionMax: 0.32,
  rapidMeanCoverageMax: 0.14,
  rapidIsolatedFractionMax: 0.18,
  rapidComponentDensityPerKMax: 45,
  rapidLargestComponentFractionMax: 0.78,
  rapidStripeAnisotropyMax: 0.58,
  smoothRiverActiveFractionMax: 0.08,
  smoothRiverMeanCoverageMax: 0.035,
  lakeShoreActiveFractionMax: 0.18,
  lakeShoreMeanCoverageMax: 0.065,
  rapidToSmoothActiveRatioMin: 1.5,
  rapidActiveMarginMin: 0.01,
  temporalDeltaMin: 0.0025,
  temporalDeltaMax: 0.09,
  temporalIouMin: 0.18,
  temporalIouMax: 0.96,
  lightingSamplesMin: 100,
  lightingMeanMax: 0.82,
  lightingP95Max: 0.94,
  lightingStdDevMin: 0.012,
});

export function evaluateFoamVisualAcceptance(
  input: FoamVisualAcceptanceInput,
): FoamVisualAcceptanceResult {
  const limits = WATER_FOAM_VISUAL_LIMITS;
  const failures: string[] = [];
  const requireMax = (label: string, value: number, max: number) => {
    if (!(value <= max)) failures.push(`${label} ${value.toFixed(4)} exceeds ${max.toFixed(4)}`);
  };
  const requireMin = (label: string, value: number, min: number) => {
    if (!(value >= min)) failures.push(`${label} ${value.toFixed(4)} is below ${min.toFixed(4)}`);
  };

  for (const [label, metrics] of [
    ["rapid", input.rapid],
    ["smooth river", input.smoothRiver],
    ["lake shore", input.lakeShore],
  ] as const) {
    requireMin(`${label} water pixels`, metrics.waterPixelCount, limits.minWaterPixels);
  }

  requireMin("rapid active fraction", input.rapid.activeFraction, limits.rapidActiveFractionMin);
  requireMax("rapid active fraction", input.rapid.activeFraction, limits.rapidActiveFractionMax);
  requireMax("rapid mean coverage", input.rapid.meanCoverage, limits.rapidMeanCoverageMax);
  requireMax("rapid isolated active fraction", input.rapid.isolatedActiveFraction, limits.rapidIsolatedFractionMax);
  requireMax("rapid component density per 1k water pixels", input.rapid.componentDensityPerK, limits.rapidComponentDensityPerKMax);
  requireMax("rapid largest component fraction", input.rapid.largestComponentFraction, limits.rapidLargestComponentFractionMax);
  requireMax("rapid stripe anisotropy", input.rapid.stripeAnisotropy, limits.rapidStripeAnisotropyMax);

  requireMax("smooth river active fraction", input.smoothRiver.activeFraction, limits.smoothRiverActiveFractionMax);
  requireMax("smooth river mean coverage", input.smoothRiver.meanCoverage, limits.smoothRiverMeanCoverageMax);
  requireMax("lake shore active fraction", input.lakeShore.activeFraction, limits.lakeShoreActiveFractionMax);
  requireMax("lake shore mean coverage", input.lakeShore.meanCoverage, limits.lakeShoreMeanCoverageMax);

  requireMin(
    "rapid/smooth active ratio",
    input.rapid.activeFraction / Math.max(input.smoothRiver.activeFraction, 1e-6),
    limits.rapidToSmoothActiveRatioMin,
  );
  requireMin(
    "rapid active margin over smooth river",
    input.rapid.activeFraction - input.smoothRiver.activeFraction,
    limits.rapidActiveMarginMin,
  );

  requireMin("rapid temporal delta", input.rapidTemporal.meanAbsoluteDelta, limits.temporalDeltaMin);
  requireMax("rapid temporal delta", input.rapidTemporal.meanAbsoluteDelta, limits.temporalDeltaMax);
  requireMin("rapid temporal IoU", input.rapidTemporal.binaryIou, limits.temporalIouMin);
  requireMax("rapid temporal IoU", input.rapidTemporal.binaryIou, limits.temporalIouMax);

  requireMin("rapid lit foam samples", input.rapidLighting.sampleCount, limits.lightingSamplesMin);
  requireMax("rapid lit foam mean luminance", input.rapidLighting.meanLuminance, limits.lightingMeanMax);
  requireMax("rapid lit foam p95 luminance", input.rapidLighting.p95Luminance, limits.lightingP95Max);
  requireMin("rapid lit foam luminance variation", input.rapidLighting.standardDeviation, limits.lightingStdDevMin);

  return { passed: failures.length === 0, failures };
}
