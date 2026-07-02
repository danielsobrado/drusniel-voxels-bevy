import { existsSync } from "node:fs";
import type {
  QaCheckResult,
  QaCheckThreshold,
  QaConfig,
  QaProbeConfig,
  QaProbeResult,
  QaSceneConfig,
  QaSceneReport,
  QaScreenshotConfig,
  QaScreenshotReport,
  QaTimingResult,
  QaTimingThreshold,
  Status,
  WebQaCheckpoint,
  WebQaScreenshot,
  WebQaSummary,
} from "./qaTypes.js";

export function evaluateScene(config: QaConfig, scene: QaSceneConfig, summary: WebQaSummary): QaSceneReport {
  if (scene.bench_scene && !sceneMatches(summary.scene, scene.bench_scene)) {
    if (scene.optional) {
      return {
        id: scene.id,
        checkpoint: scene.checkpoint,
        status: "missing_optional",
        screenshots: [],
        probes: [],
        timing: [],
        checks: [],
        failures: [],
      };
    }
    return {
      id: scene.id,
      checkpoint: scene.checkpoint,
      status: "fail",
      screenshots: [],
      probes: [],
      timing: [],
      checks: [],
      failures: [`configured bench_scene ${scene.bench_scene} does not match summary scene ${summary.scene}; likely wrong summary JSON`],
    };
  }
  const checkpoint = summary.checkpoints.find((candidate) => candidate.name === scene.checkpoint);
  if (!checkpoint) {
    return {
      id: scene.id,
      checkpoint: scene.checkpoint,
      status: "fail",
      screenshots: [],
      probes: [],
      timing: [],
      checks: [],
      failures: [`configured checkpoint ${scene.checkpoint} is missing from summary scene ${summary.scene}; likely a wrong checkpoint name or a summary from a different scene`],
    };
  }
  const screenshotsById = new Map<string, WebQaScreenshot>();
  const screenshots = scene.screenshots.map((expected): QaScreenshotReport => {
    const actual = checkpoint.screenshots?.find((candidate) => candidate.name === expected.name || candidate.id === expected.id);
    if (!actual) {
      return {
        id: expected.id,
        name: expected.name,
        path: expected.name,
        status: "fail",
        failure: `screenshot ${expected.name} was not captured in checkpoint ${scene.checkpoint}; likely the capture tool did not emit it`,
      };
    }
    screenshotsById.set(expected.id, actual);
    return evaluateScreenshot(config, scene, expected, actual);
  });

  const probes = (scene.probes ?? []).map((probe) => evaluateProbe(probe, screenshotsById));
  const timing = (scene.timing ?? []).map((threshold) => evaluateTiming(config, checkpoint, threshold));
  const checks = (scene.checks ?? []).map((check) => evaluateCheck(checkpoint, check));
  const failures = [
    ...screenshots.flatMap((screenshot) => screenshot.failure ? [`screenshot ${screenshot.id}: ${screenshot.failure}`] : []),
    ...probes.flatMap((probe) => probe.failure ? [`probe ${probe.id}: ${probe.failure}`] : []),
    ...timing.flatMap((result) => result.failure ? [`timing ${result.id}: ${result.failure}`] : []),
    ...checks.flatMap((result) => result.failure ? [`check ${result.id}: ${result.failure}`] : []),
  ];
  const status: Status = failures.length ? "fail" : screenshots.some((screenshot) => screenshot.status === "baseline_missing") ? "baseline_missing" : "pass";
  return { id: scene.id, checkpoint: scene.checkpoint, status, screenshots, probes, timing, checks, failures };
}

export function evaluateScreenshot(
  config: QaConfig,
  scene: QaSceneConfig,
  expected: QaScreenshotConfig,
  actual: WebQaScreenshot,
): QaScreenshotReport {
  const baselinePath = expected.baseline ?? `${config.baseline_root ?? "qa-baselines"}/${scene.id}/${expected.id}.png`;
  const imageDiff = config.image_diff ?? {};
  const path = actual.path ?? actual.name;
  if (imageDiff.enabled === false) {
    return { id: expected.id, name: expected.name, path, status: "pass", baseline_path: baselinePath };
  }
  if (actual.diff) {
    const changed = actual.diff.changed_ratio ?? 0;
    const rmse = actual.diff.rmse ?? 0;
    const mae = actual.diff.mean_abs_error ?? 0;
    const failed =
      changed > (imageDiff.max_changed_ratio ?? 0.02) ||
      rmse > (imageDiff.max_rmse ?? 6.0) ||
      mae > (imageDiff.max_mean_abs_error ?? 3.0);
    return {
      id: expected.id,
      name: expected.name,
      path,
      status: failed ? "fail" : "pass",
      baseline_path: baselinePath,
      failure: failed ? `diff exceeded thresholds: changed_ratio ${changed}, rmse ${rmse}, mean_abs_error ${mae}` : undefined,
    };
  }
  if (!existsSync(baselinePath)) {
    return {
      id: expected.id,
      name: expected.name,
      path,
      status: imageDiff.fail_when_baseline_missing ? "fail" : "baseline_missing",
      baseline_path: baselinePath,
      failure: imageDiff.fail_when_baseline_missing ? `baseline missing: ${baselinePath}` : undefined,
    };
  }
  return {
    id: expected.id,
    name: expected.name,
    path,
    status: "fail",
    baseline_path: baselinePath,
    failure: "diff metrics missing; capture must compare against the configured baseline",
  };
}

export function evaluateProbe(probe: QaProbeConfig, screenshotsById: Map<string, WebQaScreenshot>): QaProbeResult {
  const screenshot = screenshotsById.get(probe.screenshot);
  if (!screenshot) {
    return {
      id: probe.id,
      probe_type: probe.type,
      screenshot: probe.screenshot,
      status: "fail",
      expected: "screenshot captured",
      failure: `screenshot ${probe.screenshot} was not captured, so the probe could not run`,
    };
  }
  if (probe.type === "region_luminance") {
    return rangedProbe(probe.id, probe.type, probe.screenshot, regionMetric(screenshot, probe.id, probe.region, "luminance_mean"), probe.min, probe.max);
  }
  if (probe.type === "region_variance") {
    const observed = regionMetric(screenshot, probe.id, probe.region, "luminance_stddev");
    const status: Status = observed !== undefined && observed >= probe.min_luminance_stddev ? "pass" : "fail";
    return {
      id: probe.id,
      probe_type: probe.type,
      screenshot: probe.screenshot,
      status,
      observed,
      expected: `>= ${probe.min_luminance_stddev.toFixed(4)}`,
      failure: status === "fail" ? `luminance stddev ${observed ?? "missing"} below minimum ${probe.min_luminance_stddev}` : undefined,
    };
  }
  const key = `${probe.pixel[0]},${probe.pixel[1]}`;
  return rangedProbe(probe.id, probe.type, probe.screenshot, screenshot.metrics?.pixels?.[key], probe.min, probe.max);
}

export function evaluateTiming(config: QaConfig, checkpoint: WebQaCheckpoint, threshold: QaTimingThreshold): QaTimingResult {
  const observed = metricValue(checkpoint, threshold.area, threshold.field);
  if (observed === undefined) {
    if (threshold.optional) {
      return { id: threshold.id, area: threshold.area, field: threshold.field, status: "missing_optional", max_ms: threshold.max_ms };
    }
    return {
      id: threshold.id,
      area: threshold.area,
      field: threshold.field,
      status: "fail",
      max_ms: threshold.max_ms,
      failure: `missing required metric ${threshold.area}.${threshold.field}`,
    };
  }
  const failed = (config.timing?.fail_on_threshold ?? true) && observed > threshold.max_ms;
  return {
    id: threshold.id,
    area: threshold.area,
    field: threshold.field,
    status: failed ? "fail" : "pass",
    observed_ms: observed,
    max_ms: threshold.max_ms,
    failure: failed ? `${threshold.area}.${threshold.field} ${observed} exceeded ${threshold.max_ms}` : undefined,
  };
}

export function evaluateCheck(checkpoint: WebQaCheckpoint, check: QaCheckThreshold): QaCheckResult {
  const observed = metricValue(checkpoint, check.area, check.field);
  const expected = describeCheck(check);
  if (observed === undefined) {
    if (check.optional) {
      return { id: check.id, area: check.area, field: check.field, status: "missing_optional", expected };
    }
    return {
      id: check.id,
      area: check.area,
      field: check.field,
      status: "fail",
      expected,
      failure: `missing required metric ${check.area}.${check.field}`,
    };
  }
  const violations: string[] = [];
  if (check.max !== undefined && observed > check.max) violations.push(`> max ${check.max}`);
  if (check.min !== undefined && observed < check.min) violations.push(`< min ${check.min}`);
  if (check.equals !== undefined && observed !== check.equals) violations.push(`!= ${check.equals}`);
  const failed = violations.length > 0;
  return {
    id: check.id,
    area: check.area,
    field: check.field,
    status: failed ? "fail" : "pass",
    observed,
    expected,
    failure: failed ? `${check.area}.${check.field} ${observed} (${violations.join(", ")})` : undefined,
  };
}

export function metricValue(checkpoint: WebQaCheckpoint, area: string, field: string): number | undefined {
  if (area === "__frame") {
    if (field === "median_ms" || field === "avg_ms") return checkpoint.median_frame_ms;
    if (field === "p95_ms") return checkpoint.p95_frame_ms;
    if (field === "p99_ms") return checkpoint.p99_frame_ms;
    return undefined;
  }
  return checkpoint.areas?.[area]?.[field];
}

function rangedProbe(id: string, probeType: string, screenshot: string, observed: number | undefined, min: number, max: number): QaProbeResult {
  const status: Status = observed !== undefined && observed >= min && observed <= max ? "pass" : "fail";
  return {
    id,
    probe_type: probeType,
    screenshot,
    status,
    observed,
    expected: `${min.toFixed(4)}..=${max.toFixed(4)}`,
    failure: status === "fail" ? `luminance ${observed ?? "missing"} outside expected range ${min}..=${max}` : undefined,
  };
}

function describeCheck(check: QaCheckThreshold): string {
  const parts: string[] = [];
  if (check.min !== undefined) parts.push(`>= ${check.min}`);
  if (check.max !== undefined) parts.push(`<= ${check.max}`);
  if (check.equals !== undefined) parts.push(`== ${check.equals}`);
  return parts.length ? parts.join(" and ") : "any";
}

function sceneMatches(summaryScene: string, configuredScene: string): boolean {
  const summary = normalizePath(summaryScene);
  const configured = normalizePath(configuredScene);
  return summary === configured || summary === configured.split("/").at(-1);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function regionMetric(
  screenshot: WebQaScreenshot,
  probeId: string,
  region: readonly [number, number, number, number],
  field: "luminance_mean" | "luminance_stddev",
): number | undefined {
  const regions = screenshot.metrics?.regions;
  const keyed = regions?.[probeId] ?? regions?.[regionKey(region)];
  if (keyed?.[field] !== undefined) return keyed[field];
  if (isFullRegion(region)) return screenshot.metrics?.[field];
  return undefined;
}

function regionKey(region: readonly [number, number, number, number]): string {
  return region.map((value) => String(value)).join(",");
}

function isFullRegion(region: readonly [number, number, number, number]): boolean {
  return region[0] === 0 && region[1] === 0 && region[2] === 1 && region[3] === 1;
}
