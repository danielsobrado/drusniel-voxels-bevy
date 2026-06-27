import type { NaadfPocConfig } from "./config.js";
import type { NaadfPocMetricsSnapshot } from "./metrics.js";

export type AcceptanceCheck = Readonly<{
  name: string;
  passed: boolean;
  detail: string;
}>;

export function runAcceptanceChecks(
  config: NaadfPocConfig,
  metrics: NaadfPocMetricsSnapshot,
  warmupFrames: number,
): AcceptanceCheck[] {
  const warmedUp = metrics.frame >= warmupFrames;
  const checks: AcceptanceCheck[] = [];

  checks.push({
    name: "visible_holes",
    passed: !warmedUp || metrics.visibleHoles <= config.acceptance.maxVisibleHoles,
    detail: `${metrics.visibleHoles} <= ${config.acceptance.maxVisibleHoles}`,
  });

  checks.push({
    name: "missing_samples",
    passed: !warmedUp || metrics.missingSamples <= config.acceptance.maxMissingSamplesPerFrame,
    detail: `${metrics.missingSamples} <= ${config.acceptance.maxMissingSamplesPerFrame}`,
  });

  checks.push({
    name: "primary_steps_p95",
    passed: !warmedUp || metrics.primaryStepsP95 <= config.acceptance.maxP95PrimarySteps,
    detail: `${metrics.primaryStepsP95.toFixed(1)} <= ${config.acceptance.maxP95PrimarySteps}`,
  });

  checks.push({
    name: "sun_steps_p95",
    passed: !warmedUp || metrics.sunStepsP95 <= config.acceptance.maxP95SunSteps,
    detail: `${metrics.sunStepsP95.toFixed(1)} <= ${config.acceptance.maxP95SunSteps}`,
  });

  checks.push({
    name: "hdda_dense_mismatches",
    passed: config.traversal.mode !== "compare" || !warmedUp || metrics.hddaDenseMismatches === 0,
    detail: config.traversal.mode === "compare"
      ? `${metrics.hddaDenseMismatches} == 0`
      : "disabled outside compare mode",
  });

  return checks;
}

export function allAcceptancePassed(checks: ReadonlyArray<AcceptanceCheck>): boolean {
  return checks.every((c) => c.passed);
}
