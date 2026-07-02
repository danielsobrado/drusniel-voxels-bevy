import type { ClodPageNode } from "../types.js";
import type { AcceptanceConfig, AcceptanceGateResult } from "./acceptanceTypes.js";
import { MIXED_LOD_FAILURE_CODES } from "./acceptanceTypes.js";
import { buildTolerances } from "./borderChainComparison.js";
import { validateAllMixedLodCuts } from "./borderMixedLodValidation.js";
import {
  validateSameLevelStrictEquality,
  validateSameLevelWatertightness,
} from "./borderSameLevelValidation.js";

export function runGateA1(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  fixtureName: string,
): AcceptanceGateResult {
  const tolerances = buildTolerances(config.thresholds);
  const sameLevel = validateSameLevelWatertightness(nodesByLevel, tolerances);
  const mixed = validateAllMixedLodCuts(nodesByLevel, config, fixtureName);

  const realMixedFailures = mixed.failures.filter(
    (f) => f.code !== MIXED_LOD_FAILURE_CODES.UNTESTABLE_DELTA,
  );
  const allFailures = [
    ...sameLevel.failures,
    ...realMixedFailures,
  ];
  const failureCount = allFailures.length;

  const mixedEqualityCount = mixed.surfaceFindings.length;

  const maxPosDelta = Math.max(sameLevel.maxPositionDelta, mixed.maxPosDelta);
  const minNormDot = Math.min(sameLevel.minNormalDot, mixed.minNormDot);
  const maxMatDelta = Math.max(sameLevel.maxMaterialWeightDelta, mixed.maxMatDelta);

  let status: "pass" | "warn" | "fail";
  let message: string;

  if (sameLevel.failureCount > 0 || realMixedFailures.length > 0) {
    status = "fail";
    message = `${sameLevel.failureCount} same-level failures, ${realMixedFailures.length} mixed-LOD failures`;
  } else if (mixed.untestableDeltaCount > 0) {
    status = "warn";
    message = `No topology gaps found, but ${mixed.untestableDeltaCount} of ${config.stressScenes.forcedNeighborLodDeltas.length} configured deltas are untestable with the current hierarchy depth`;
  } else {
    status = "pass";
    message = "No holes or lips found in border chain validation";
  }

  if (mixed.edgesTested === 0 && config.stressScenes.forcedNeighborLodDeltas.length > 0) {
    status = "warn";
    message = "No mixed-LOD edges tested — mixed-LOD validation did not run. Consider this a blocker for Phase 4/5.";
  }

  const failures = allFailures.map((f) => ({
    ...f,
    scene: fixtureName,
  }));

  return {
    id: "A1",
    name: "Watertight",
    status,
    message,
    measurements: {
      maxPositionDelta: maxPosDelta,
      minNormalDot: minNormDot,
      maxMaterialWeightDelta: maxMatDelta,
      failureCount,
      borderPositionEpsilon: config.thresholds.borderPositionEpsilon,
      sameLevelEdgesTested: sameLevel.edgesTested,
      sameLevelFailureCount: sameLevel.failureCount,
      mixedLodDeltasTested: mixed.deltasTested,
      mixedLodEdgesTested: mixed.edgesTested,
      mixedLodFailureCount: mixed.failureCount,
      mixedLodUntestableDeltaCount: mixed.untestableDeltaCount,
      mixedLodSurfaceFindingsCount: mixedEqualityCount,
      visualSweepAvailable: false,
      visualSweepStatus: "disabled",
    },
    failures,
  };
}

export function runGateA2(
  nodesByLevel: Map<number, ClodPageNode[]>,
  config: AcceptanceConfig,
  fixtureName: string,
): AcceptanceGateResult {
  const tolerances = buildTolerances(config.thresholds);
  const result = validateSameLevelStrictEquality(nodesByLevel, tolerances);

  const status = result.passes ? "pass" : "fail";
  const message = result.passes
    ? `Border equality within thresholds: pos <= ${config.thresholds.borderPositionEpsilon}, normal dot >= ${config.thresholds.borderNormalDotMin}`
    : `${result.failureCount} border equality mismatches`;

  const failures = result.failures.map((f) => ({
    ...f,
    scene: fixtureName,
  }));

  return {
    id: "A2",
    name: "Border equality",
    status,
    message,
    measurements: {
      maxPositionDelta: result.maxPositionDelta,
      minNormalDot: result.minNormalDot,
      maxMaterialWeightDelta: result.maxMaterialWeightDelta,
      failureCount: result.failureCount,
      borderPositionEpsilon: config.thresholds.borderPositionEpsilon,
      borderNormalDotMin: config.thresholds.borderNormalDotMin,
      borderMaterialWeightDeltaMax: config.thresholds.borderMaterialWeightDeltaMax,
    },
    failures,
  };
}
