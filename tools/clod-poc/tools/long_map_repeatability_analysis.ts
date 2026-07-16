import { percentile } from "./infinite_acceptance/route_metrics.js";

export interface RepeatabilityMetrics {
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  frameP999Ms: number;
  maxFrameMs: number;
  framesOver16_7Ms: number;
  framesOver33_3Ms: number;
  framesOver100Ms: number;
  longTaskCount: number;
  longestLongTaskMs: number;
}

export interface RepeatabilityRun {
  id: string;
  passed: boolean;
  freshProfile: boolean;
  environmentKey: string;
  metrics: RepeatabilityMetrics;
}

export interface RepeatabilityMetricSummary {
  median: number;
  worst: number;
  spread: number;
}

export interface RepeatabilityEvaluation {
  passed: boolean;
  failures: string[];
  metrics: Record<keyof RepeatabilityMetrics, RepeatabilityMetricSummary>;
}

const METRIC_KEYS: readonly (keyof RepeatabilityMetrics)[] = [
  "frameP50Ms", "frameP95Ms", "frameP99Ms", "frameP999Ms", "maxFrameMs",
  "framesOver16_7Ms", "framesOver33_3Ms", "framesOver100Ms", "longTaskCount", "longestLongTaskMs",
];

export function evaluateRepeatability(runs: readonly RepeatabilityRun[]): RepeatabilityEvaluation {
  const regular = runs.filter((run) => !run.freshProfile);
  const fresh = runs.filter((run) => run.freshProfile);
  const failures: string[] = [];
  if (regular.length !== 5) failures.push(`expected 5 repeated runs, received ${regular.length}`);
  if (fresh.length !== 1) failures.push(`expected 1 fresh-profile run, received ${fresh.length}`);
  const environments = new Set(regular.map((run) => run.environmentKey));
  if (environments.size > 1) failures.push(`repeated runs used ${environments.size} different environments`);
  for (const run of runs) if (!run.passed) failures.push(`${run.id}: source report did not pass`);
  for (const run of runs) {
    for (const key of METRIC_KEYS) {
      if (!Number.isFinite(run.metrics[key])) failures.push(`${run.id}: ${key} is not finite`);
    }
  }
  const metrics = Object.fromEntries(METRIC_KEYS.map((key) => {
    const values = regular.map((run) => run.metrics[key]).filter(Number.isFinite);
    const min = values.length > 0 ? Math.min(...values) : Number.NaN;
    const max = values.length > 0 ? Math.max(...values) : Number.NaN;
    return [key, { median: percentile(values, 0.5), worst: max, spread: max - min }];
  })) as Record<keyof RepeatabilityMetrics, RepeatabilityMetricSummary>;
  return { passed: failures.length === 0, failures, metrics };
}
