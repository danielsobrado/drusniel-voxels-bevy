export interface ContinentRouteTailThresholds {
  readonly maxFrameP50Ms: number;
  readonly maxFrameP95Ms: number;
  readonly maxFrameP99Ms: number;
  readonly maxFrameP999Ms: number;
  readonly maxFrameMs: number;
  readonly maxFramesOver16_7Ms: number;
  readonly maxFramesOver33_3Ms: number;
  readonly maxLongTaskCount: number;
  readonly maxLongestLongTaskMs: number;
  readonly maxTopPhaseP95Ms: number;
  readonly maxTopPhaseMs: number;
}

export interface ContinentRouteTailEvidence {
  readonly frameP50Ms: number;
  readonly frameP95Ms: number;
  readonly frameP99Ms: number;
  readonly frameP999Ms: number;
  readonly maxFrameMs: number;
  readonly framesOver16_7Ms: number;
  readonly framesOver33_3Ms: number;
  readonly longTaskCount: number;
  readonly longestLongTaskMs: number;
  readonly topPhaseP95Ms: number;
  readonly topPhaseMaxMs: number;
}

export function evaluateContinentRouteTails(
  evidence: ContinentRouteTailEvidence,
  thresholds: ContinentRouteTailThresholds,
): string[] {
  const checks: Array<[string, number, number]> = [
    ["frame p50", evidence.frameP50Ms, thresholds.maxFrameP50Ms],
    ["frame p95", evidence.frameP95Ms, thresholds.maxFrameP95Ms],
    ["frame p99", evidence.frameP99Ms, thresholds.maxFrameP99Ms],
    ["frame p99.9", evidence.frameP999Ms, thresholds.maxFrameP999Ms],
    ["max frame", evidence.maxFrameMs, thresholds.maxFrameMs],
    ["frames >16.7ms", evidence.framesOver16_7Ms, thresholds.maxFramesOver16_7Ms],
    ["frames >33.3ms", evidence.framesOver33_3Ms, thresholds.maxFramesOver33_3Ms],
    ["long-task count", evidence.longTaskCount, thresholds.maxLongTaskCount],
    ["longest long task", evidence.longestLongTaskMs, thresholds.maxLongestLongTaskMs],
    ["top phase p95", evidence.topPhaseP95Ms, thresholds.maxTopPhaseP95Ms],
    ["top phase max", evidence.topPhaseMaxMs, thresholds.maxTopPhaseMs],
  ];
  return checks.flatMap(([label, value, limit]) =>
    Number.isFinite(value) && value <= limit ? [] : [`${label} ${value.toFixed(3)} > ${limit.toFixed(3)}`]);
}
