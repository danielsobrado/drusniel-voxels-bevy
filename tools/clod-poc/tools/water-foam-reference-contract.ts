import type {
  FoamImageMetrics,
  FoamLightingMetrics,
  FoamTemporalMetrics,
} from "./water-foam-visual-metrics.js";
import type {
  WaterFoamReferenceManifest,
  WaterFoamReferenceScene,
  WaterFoamReferenceSceneId,
} from "./water-foam-reference-manifest.js";

export const WATER_FOAM_REFERENCE_LIMITS = Object.freeze({
  minimumWaterPixels: 1_000,
  imageRelativeDeltaMax: 0.30,
  isolatedFractionAbsoluteDeltaMax: 0.08,
  componentDensityLog2DeltaMax: 1.0,
  largestComponentAbsoluteDeltaMax: 0.15,
  stripeAnisotropyExcessMax: 0.08,
  temporalDeltaRelativeMax: 0.40,
  temporalIouAbsoluteDeltaMax: 0.20,
  lightingMeanAbsoluteDeltaMax: 0.12,
  lightingP95AbsoluteDeltaMax: 0.12,
  lightingVariationRelativeMax: 0.50,
  rapidToSmoothRatioRelativeMax: 0.30,
});

export interface WaterFoamReferenceDifference {
  readonly label: string;
  readonly reference: number;
  readonly candidate: number;
  readonly difference: number;
  readonly limit: number;
  readonly passed: boolean;
}

export interface WaterFoamReferenceComparison {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly differences: readonly WaterFoamReferenceDifference[];
}

export function compareWaterFoamToFableReference(
  reference: WaterFoamReferenceManifest,
  candidate: WaterFoamReferenceManifest,
): WaterFoamReferenceComparison {
  if (reference.source.kind !== "fable5-world-demo") {
    throw new Error("foam reference comparison requires fable5-world-demo as reference");
  }
  if (candidate.source.kind !== "drusniel-clod-poc") {
    throw new Error("foam reference comparison requires drusniel-clod-poc as candidate");
  }

  const failures: string[] = [];
  const differences: WaterFoamReferenceDifference[] = [];
  for (const sceneId of ["rapid", "smoothRiver", "lakeShore"] as const) {
    compareSceneDimensions(reference.scenes[sceneId], candidate.scenes[sceneId], sceneId);
    compareImageMetrics(reference.scenes[sceneId].image, candidate.scenes[sceneId].image, sceneId, failures, differences);
  }
  compareTemporal(reference.scenes.rapid.temporal!, candidate.scenes.rapid.temporal!, failures, differences);
  compareLighting(reference.scenes.rapid.lighting!, candidate.scenes.rapid.lighting!, failures, differences);
  compareRapidToSmoothRatio(reference, candidate, failures, differences);
  return { passed: failures.length === 0, failures, differences };
}

function compareSceneDimensions(
  reference: WaterFoamReferenceScene,
  candidate: WaterFoamReferenceScene,
  sceneId: WaterFoamReferenceSceneId,
): void {
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error(
      `${sceneId} reference dimensions ${reference.width}x${reference.height} do not match candidate ${candidate.width}x${candidate.height}`,
    );
  }
}

function compareImageMetrics(
  reference: FoamImageMetrics,
  candidate: FoamImageMetrics,
  sceneId: WaterFoamReferenceSceneId,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
): void {
  requireMinimum(
    `${sceneId}.waterPixelCount`,
    candidate.waterPixelCount,
    WATER_FOAM_REFERENCE_LIMITS.minimumWaterPixels,
    failures,
    differences,
  );
  requireRelative(
    `${sceneId}.activeFraction`, reference.activeFraction, candidate.activeFraction,
    WATER_FOAM_REFERENCE_LIMITS.imageRelativeDeltaMax, 0.01, failures, differences,
  );
  requireRelative(
    `${sceneId}.meanCoverage`, reference.meanCoverage, candidate.meanCoverage,
    WATER_FOAM_REFERENCE_LIMITS.imageRelativeDeltaMax, 0.01, failures, differences,
  );
  requireAbsolute(
    `${sceneId}.isolatedActiveFraction`, reference.isolatedActiveFraction, candidate.isolatedActiveFraction,
    WATER_FOAM_REFERENCE_LIMITS.isolatedFractionAbsoluteDeltaMax, failures, differences,
  );
  requireLog2Ratio(
    `${sceneId}.componentDensityPerK`, reference.componentDensityPerK, candidate.componentDensityPerK,
    WATER_FOAM_REFERENCE_LIMITS.componentDensityLog2DeltaMax, failures, differences,
  );
  requireAbsolute(
    `${sceneId}.largestComponentFraction`, reference.largestComponentFraction, candidate.largestComponentFraction,
    WATER_FOAM_REFERENCE_LIMITS.largestComponentAbsoluteDeltaMax, failures, differences,
  );
  requireMaximum(
    `${sceneId}.stripeAnisotropy`, candidate.stripeAnisotropy,
    reference.stripeAnisotropy + WATER_FOAM_REFERENCE_LIMITS.stripeAnisotropyExcessMax,
    failures, differences, reference.stripeAnisotropy,
  );
}

function compareTemporal(
  reference: FoamTemporalMetrics,
  candidate: FoamTemporalMetrics,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
): void {
  requireRelative(
    "rapid.temporal.meanAbsoluteDelta", reference.meanAbsoluteDelta, candidate.meanAbsoluteDelta,
    WATER_FOAM_REFERENCE_LIMITS.temporalDeltaRelativeMax, 0.0025, failures, differences,
  );
  requireAbsolute(
    "rapid.temporal.binaryIou", reference.binaryIou, candidate.binaryIou,
    WATER_FOAM_REFERENCE_LIMITS.temporalIouAbsoluteDeltaMax, failures, differences,
  );
}

function compareLighting(
  reference: FoamLightingMetrics,
  candidate: FoamLightingMetrics,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
): void {
  requireMinimum(
    "rapid.lighting.sampleCount", candidate.sampleCount, 100, failures, differences,
  );
  requireAbsolute(
    "rapid.lighting.meanLuminance", reference.meanLuminance, candidate.meanLuminance,
    WATER_FOAM_REFERENCE_LIMITS.lightingMeanAbsoluteDeltaMax, failures, differences,
  );
  requireAbsolute(
    "rapid.lighting.p95Luminance", reference.p95Luminance, candidate.p95Luminance,
    WATER_FOAM_REFERENCE_LIMITS.lightingP95AbsoluteDeltaMax, failures, differences,
  );
  requireRelative(
    "rapid.lighting.standardDeviation", reference.standardDeviation, candidate.standardDeviation,
    WATER_FOAM_REFERENCE_LIMITS.lightingVariationRelativeMax, 0.01, failures, differences,
  );
}

function compareRapidToSmoothRatio(
  reference: WaterFoamReferenceManifest,
  candidate: WaterFoamReferenceManifest,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
): void {
  const referenceRatio = reference.scenes.rapid.image.activeFraction
    / Math.max(0.001, reference.scenes.smoothRiver.image.activeFraction);
  const candidateRatio = candidate.scenes.rapid.image.activeFraction
    / Math.max(0.001, candidate.scenes.smoothRiver.image.activeFraction);
  requireRelative(
    "rapidToSmooth.activeFractionRatio",
    referenceRatio,
    candidateRatio,
    WATER_FOAM_REFERENCE_LIMITS.rapidToSmoothRatioRelativeMax,
    0.1,
    failures,
    differences,
  );
}

function requireRelative(
  label: string,
  reference: number,
  candidate: number,
  limit: number,
  floor: number,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
): void {
  const difference = Math.abs(candidate - reference) / Math.max(floor, Math.abs(reference));
  record(label, reference, candidate, difference, limit, difference <= limit, failures, differences, "relative delta");
}

function requireAbsolute(
  label: string,
  reference: number,
  candidate: number,
  limit: number,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
): void {
  const difference = Math.abs(candidate - reference);
  record(label, reference, candidate, difference, limit, difference <= limit, failures, differences, "absolute delta");
}

function requireLog2Ratio(
  label: string,
  reference: number,
  candidate: number,
  limit: number,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
): void {
  const difference = Math.abs(Math.log2((candidate + 1) / (reference + 1)));
  record(label, reference, candidate, difference, limit, difference <= limit, failures, differences, "log2 ratio delta");
}

function requireMinimum(
  label: string,
  candidate: number,
  minimum: number,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
): void {
  const difference = Math.max(0, minimum - candidate);
  record(label, minimum, candidate, difference, 0, candidate >= minimum, failures, differences, "minimum shortfall");
}

function requireMaximum(
  label: string,
  candidate: number,
  maximum: number,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
  reference: number,
): void {
  const difference = Math.max(0, candidate - maximum);
  record(label, reference, candidate, difference, 0, candidate <= maximum, failures, differences, "maximum excess");
}

function record(
  label: string,
  reference: number,
  candidate: number,
  difference: number,
  limit: number,
  passed: boolean,
  failures: string[],
  differences: WaterFoamReferenceDifference[],
  differenceKind: string,
): void {
  differences.push({ label, reference, candidate, difference, limit, passed });
  if (!passed) {
    failures.push(
      `${label} ${differenceKind} ${difference.toFixed(4)} exceeds ${limit.toFixed(4)} `
      + `(reference=${reference.toFixed(4)}, candidate=${candidate.toFixed(4)})`,
    );
  }
}
