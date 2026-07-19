import type { FoamVisualAcceptanceInput } from "./water-foam-visual-contract.js";

export interface WaterFoamRendererParityResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly measurements: Readonly<Record<string, number>>;
}

export const WATER_FOAM_RENDERER_PARITY_LIMITS = Object.freeze({
  waterPixelRatioMin: 0.75,
  waterPixelRatioMax: 1.25,
  rapidActiveRatioMin: 0.35,
  rapidActiveRatioMax: 1.65,
  rapidMeanCoverageRatioMin: 0.25,
  rapidMeanCoverageRatioMax: 1.75,
  rapidComponentDensityDeltaMax: 20.0,
  rapidLargestComponentDeltaMax: 0.28,
  rapidStripeDeltaMax: 0.22,
  rapidIsolatedDeltaMax: 0.20,
  smoothRiverActiveExcessMax: 0.04,
  smoothRiverCoverageExcessMax: 0.025,
  lakeShoreActiveDeltaMax: 0.08,
  lakeShoreCoverageDeltaMax: 0.05,
  lightingMeanDeltaMax: 0.20,
  lightingP95DeltaMax: 0.20,
  lightingVariationRatioMin: 0.20,
  lightingVariationRatioMax: 3.00,
  temporalDeltaRatioMin: 0.20,
  temporalDeltaRatioMax: 3.00,
  temporalIouDeltaMax: 0.40,
});

export function evaluateWaterFoamRendererParity(
  webGpu: FoamVisualAcceptanceInput,
  webGl: FoamVisualAcceptanceInput,
): WaterFoamRendererParityResult {
  const limits = WATER_FOAM_RENDERER_PARITY_LIMITS;
  const measurements = {
    rapidWaterPixelRatio: ratio(webGl.rapid.waterPixelCount, webGpu.rapid.waterPixelCount),
    smoothRiverWaterPixelRatio: ratio(webGl.smoothRiver.waterPixelCount, webGpu.smoothRiver.waterPixelCount),
    lakeShoreWaterPixelRatio: ratio(webGl.lakeShore.waterPixelCount, webGpu.lakeShore.waterPixelCount),
    rapidActiveRatio: ratio(webGl.rapid.activeFraction, webGpu.rapid.activeFraction),
    rapidMeanCoverageRatio: ratio(webGl.rapid.meanCoverage, webGpu.rapid.meanCoverage),
    rapidComponentDensityDelta: delta(
      webGl.rapid.componentDensityPerK,
      webGpu.rapid.componentDensityPerK,
    ),
    rapidLargestComponentDelta: delta(
      webGl.rapid.largestComponentFraction,
      webGpu.rapid.largestComponentFraction,
    ),
    rapidStripeDelta: delta(webGl.rapid.stripeAnisotropy, webGpu.rapid.stripeAnisotropy),
    rapidIsolatedDelta: delta(
      webGl.rapid.isolatedActiveFraction,
      webGpu.rapid.isolatedActiveFraction,
    ),
    smoothRiverActiveExcess: webGl.smoothRiver.activeFraction - webGpu.smoothRiver.activeFraction,
    smoothRiverCoverageExcess: webGl.smoothRiver.meanCoverage - webGpu.smoothRiver.meanCoverage,
    lakeShoreActiveDelta: delta(
      webGl.lakeShore.activeFraction,
      webGpu.lakeShore.activeFraction,
    ),
    lakeShoreCoverageDelta: delta(webGl.lakeShore.meanCoverage, webGpu.lakeShore.meanCoverage),
    lightingMeanDelta: delta(
      webGl.rapidLighting.meanLuminance,
      webGpu.rapidLighting.meanLuminance,
    ),
    lightingP95Delta: delta(
      webGl.rapidLighting.p95Luminance,
      webGpu.rapidLighting.p95Luminance,
    ),
    lightingVariationRatio: ratio(
      webGl.rapidLighting.standardDeviation,
      webGpu.rapidLighting.standardDeviation,
    ),
    temporalDeltaRatio: ratio(
      webGl.rapidTemporal.meanAbsoluteDelta,
      webGpu.rapidTemporal.meanAbsoluteDelta,
    ),
    temporalIouDelta: delta(webGl.rapidTemporal.binaryIou, webGpu.rapidTemporal.binaryIou),
  };
  const failures: string[] = [];

  for (const [label, value] of [
    ["rapid water-pixel ratio WebGL/WebGPU", measurements.rapidWaterPixelRatio],
    ["smooth-river water-pixel ratio WebGL/WebGPU", measurements.smoothRiverWaterPixelRatio],
    ["lake-shore water-pixel ratio WebGL/WebGPU", measurements.lakeShoreWaterPixelRatio],
  ] as const) {
    requireRange(failures, label, value, limits.waterPixelRatioMin, limits.waterPixelRatioMax);
  }
  requireRange(
    failures,
    "rapid active ratio WebGL/WebGPU",
    measurements.rapidActiveRatio,
    limits.rapidActiveRatioMin,
    limits.rapidActiveRatioMax,
  );
  requireRange(
    failures,
    "rapid mean coverage ratio WebGL/WebGPU",
    measurements.rapidMeanCoverageRatio,
    limits.rapidMeanCoverageRatioMin,
    limits.rapidMeanCoverageRatioMax,
  );
  requireMax(
    failures,
    "rapid component-density delta",
    measurements.rapidComponentDensityDelta,
    limits.rapidComponentDensityDeltaMax,
  );
  requireMax(
    failures,
    "rapid largest-component delta",
    measurements.rapidLargestComponentDelta,
    limits.rapidLargestComponentDeltaMax,
  );
  requireMax(failures, "rapid stripe delta", measurements.rapidStripeDelta, limits.rapidStripeDeltaMax);
  requireMax(failures, "rapid isolated delta", measurements.rapidIsolatedDelta, limits.rapidIsolatedDeltaMax);
  requireMax(
    failures,
    "smooth-river active excess",
    measurements.smoothRiverActiveExcess,
    limits.smoothRiverActiveExcessMax,
  );
  requireMax(
    failures,
    "smooth-river coverage excess",
    measurements.smoothRiverCoverageExcess,
    limits.smoothRiverCoverageExcessMax,
  );
  requireMax(
    failures,
    "lake-shore active delta",
    measurements.lakeShoreActiveDelta,
    limits.lakeShoreActiveDeltaMax,
  );
  requireMax(
    failures,
    "lake-shore coverage delta",
    measurements.lakeShoreCoverageDelta,
    limits.lakeShoreCoverageDeltaMax,
  );
  requireMax(
    failures,
    "lit-foam mean luminance delta",
    measurements.lightingMeanDelta,
    limits.lightingMeanDeltaMax,
  );
  requireMax(
    failures,
    "lit-foam p95 luminance delta",
    measurements.lightingP95Delta,
    limits.lightingP95DeltaMax,
  );
  requireRange(
    failures,
    "lit-foam luminance-variation ratio WebGL/WebGPU",
    measurements.lightingVariationRatio,
    limits.lightingVariationRatioMin,
    limits.lightingVariationRatioMax,
  );
  requireRange(
    failures,
    "rapid temporal-delta ratio WebGL/WebGPU",
    measurements.temporalDeltaRatio,
    limits.temporalDeltaRatioMin,
    limits.temporalDeltaRatioMax,
  );
  requireMax(
    failures,
    "rapid temporal IoU delta",
    measurements.temporalIouDelta,
    limits.temporalIouDeltaMax,
  );

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

function requireMax(failures: string[], label: string, value: number, max: number): void {
  if (!Number.isFinite(value) || value > max) failures.push(`${label} ${format(value)} exceeds ${max.toFixed(4)}`);
}

function requireRange(failures: string[], label: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min) failures.push(`${label} ${format(value)} is below ${min.toFixed(4)}`);
  if (!Number.isFinite(value) || value > max) failures.push(`${label} ${format(value)} exceeds ${max.toFixed(4)}`);
}

function format(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "non-finite";
}
