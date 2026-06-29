export const TREE_IMPOSTOR_MIN_LIGHT_VARIATION = 0.03;
export const TREE_IMPOSTOR_MAX_VIEW_BLEND_DELTA = 0.18;
export const TREE_IMPOSTOR_MAX_NEAR_COLOR_DELTA = 0.22;
export const TREE_IMPOSTOR_MIN_PERF_SPEEDUP = 1.15;
export const TREE_IMPOSTOR_MAX_BOUNDARY_DOUBLE_DRAW_RATIO = 0;
export const TREE_IMPOSTOR_MAX_BOUNDARY_HOLE_RATIO = 0;

export interface TreeImpostorVisualSample {
  luminanceMean: number;
  luminanceStdDev: number;
  maxViewBlendDelta: number;
  nearImpostorColorDelta: number;
  boundaryHoleRatio: number;
  boundaryDoubleDrawRatio: number;
}

export interface TreeImpostorPerfSample {
  baselineFrameMsP95: number;
  impostorFrameMsP95: number;
}

export interface TreeImpostorAcceptanceThresholds {
  minLightVariation: number;
  maxViewBlendDelta: number;
  maxNearColorDelta: number;
  minPerfSpeedup: number;
  maxBoundaryHoleRatio: number;
  maxBoundaryDoubleDrawRatio: number;
}

export interface TreeImpostorAcceptanceFailure {
  code: string;
  message: string;
  value: number;
  threshold: number;
}

export interface TreeImpostorAcceptanceReport {
  status: "pass" | "fail";
  measurements: {
    lightVariation: number;
    maxViewBlendDelta: number;
    nearImpostorColorDelta: number;
    boundaryHoleRatio: number;
    boundaryDoubleDrawRatio: number;
    perfSpeedup: number;
    baselineFrameMsP95: number;
    impostorFrameMsP95: number;
  };
  failures: TreeImpostorAcceptanceFailure[];
}

export function defaultTreeImpostorAcceptanceThresholds(): TreeImpostorAcceptanceThresholds {
  return {
    minLightVariation: TREE_IMPOSTOR_MIN_LIGHT_VARIATION,
    maxViewBlendDelta: TREE_IMPOSTOR_MAX_VIEW_BLEND_DELTA,
    maxNearColorDelta: TREE_IMPOSTOR_MAX_NEAR_COLOR_DELTA,
    minPerfSpeedup: TREE_IMPOSTOR_MIN_PERF_SPEEDUP,
    maxBoundaryHoleRatio: TREE_IMPOSTOR_MAX_BOUNDARY_HOLE_RATIO,
    maxBoundaryDoubleDrawRatio: TREE_IMPOSTOR_MAX_BOUNDARY_DOUBLE_DRAW_RATIO,
  };
}

export function evaluateTreeImpostorAcceptance(
  visual: TreeImpostorVisualSample,
  perf: TreeImpostorPerfSample,
  thresholds: TreeImpostorAcceptanceThresholds = defaultTreeImpostorAcceptanceThresholds(),
): TreeImpostorAcceptanceReport {
  const perfSpeedup = computeTreeImpostorPerfSpeedup(perf);
  const measurements = {
    lightVariation: visual.luminanceStdDev,
    maxViewBlendDelta: visual.maxViewBlendDelta,
    nearImpostorColorDelta: visual.nearImpostorColorDelta,
    boundaryHoleRatio: visual.boundaryHoleRatio,
    boundaryDoubleDrawRatio: visual.boundaryDoubleDrawRatio,
    perfSpeedup,
    baselineFrameMsP95: perf.baselineFrameMsP95,
    impostorFrameMsP95: perf.impostorFrameMsP95,
  };
  const failures: TreeImpostorAcceptanceFailure[] = [];

  if (visual.luminanceStdDev < thresholds.minLightVariation) {
    failures.push({
      code: "TREE_IMPOSTOR_FLAT_LIGHTING",
      message: "Tree impostor lighting variation is too low; billboard may be flat/unlit.",
      value: visual.luminanceStdDev,
      threshold: thresholds.minLightVariation,
    });
  }
  if (visual.maxViewBlendDelta > thresholds.maxViewBlendDelta) {
    failures.push({
      code: "TREE_IMPOSTOR_VIEW_BLEND_POP",
      message: "Tree impostor view blend delta is above the allowed rotation continuity threshold.",
      value: visual.maxViewBlendDelta,
      threshold: thresholds.maxViewBlendDelta,
    });
  }
  if (visual.nearImpostorColorDelta > thresholds.maxNearColorDelta) {
    failures.push({
      code: "TREE_IMPOSTOR_NEAR_COLOR_MISMATCH",
      message: "Near tree mesh and impostor color differ too much for the same species.",
      value: visual.nearImpostorColorDelta,
      threshold: thresholds.maxNearColorDelta,
    });
  }
  if (visual.boundaryHoleRatio > thresholds.maxBoundaryHoleRatio) {
    failures.push({
      code: "TREE_IMPOSTOR_BOUNDARY_HOLES",
      message: "Far-to-impostor transition contains missing pixels.",
      value: visual.boundaryHoleRatio,
      threshold: thresholds.maxBoundaryHoleRatio,
    });
  }
  if (visual.boundaryDoubleDrawRatio > thresholds.maxBoundaryDoubleDrawRatio) {
    failures.push({
      code: "TREE_IMPOSTOR_BOUNDARY_DOUBLE_DRAW",
      message: "Far-to-impostor transition contains double-drawn pixels.",
      value: visual.boundaryDoubleDrawRatio,
      threshold: thresholds.maxBoundaryDoubleDrawRatio,
    });
  }
  if (perfSpeedup < thresholds.minPerfSpeedup) {
    failures.push({
      code: "TREE_IMPOSTOR_PERF_REGRESSION",
      message: "GPU ring baked impostor path is not faster than the baseline by the required margin.",
      value: perfSpeedup,
      threshold: thresholds.minPerfSpeedup,
    });
  }

  return {
    status: failures.length === 0 ? "pass" : "fail",
    measurements,
    failures,
  };
}

export function computeTreeImpostorPerfSpeedup(perf: TreeImpostorPerfSample): number {
  if (!Number.isFinite(perf.baselineFrameMsP95) || !Number.isFinite(perf.impostorFrameMsP95)) {
    return 0;
  }
  if (perf.baselineFrameMsP95 <= 0 || perf.impostorFrameMsP95 <= 0) {
    return 0;
  }
  return perf.baselineFrameMsP95 / perf.impostorFrameMsP95;
}
