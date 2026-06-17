import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";

type Status = "pass" | "fail" | "baseline_missing" | "missing_optional";

interface QaConfigFile {
  qa: QaConfig;
}

interface QaConfig {
  output_root?: string;
  baseline_root?: string;
  report_json_name?: string;
  report_markdown_name?: string;
  image_diff?: ImageDiffConfig;
  timing?: TimingConfig;
  scenes: QaSceneConfig[];
}

interface ImageDiffConfig {
  enabled?: boolean;
  fail_when_baseline_missing?: boolean;
  max_changed_ratio?: number;
  max_rmse?: number;
  max_mean_abs_error?: number;
}

interface TimingConfig {
  enabled?: boolean;
  fail_on_threshold?: boolean;
}

interface QaSceneConfig {
  id: string;
  bench_scene?: string;
  checkpoint: string;
  screenshots: QaScreenshotConfig[];
  probes?: QaProbeConfig[];
  timing?: QaTimingThreshold[];
}

interface QaScreenshotConfig {
  id: string;
  name: string;
  baseline?: string;
}

type QaProbeConfig =
  | {
      id: string;
      type: "region_luminance";
      screenshot: string;
      region: [number, number, number, number];
      min: number;
      max: number;
    }
  | {
      id: string;
      type: "region_variance";
      screenshot: string;
      region: [number, number, number, number];
      min_luminance_stddev: number;
    }
  | {
      id: string;
      type: "pixel_luminance";
      screenshot: string;
      pixel: [number, number];
      min: number;
      max: number;
    };

interface QaTimingThreshold {
  id: string;
  area: string;
  field: string;
  max_ms: number;
  optional?: boolean;
}

interface WebQaSummary {
  scene: string;
  git_sha?: string | null;
  git_dirty?: boolean | null;
  build_profile?: string;
  platform?: string;
  run_started_utc?: string;
  duration_secs?: number;
  checkpoints: WebQaCheckpoint[];
}

interface WebQaCheckpoint {
  name: string;
  median_frame_ms?: number;
  p95_frame_ms?: number;
  p99_frame_ms?: number;
  areas?: Record<string, Record<string, number>>;
  screenshots?: WebQaScreenshot[];
}

interface WebQaScreenshot {
  id?: string;
  name: string;
  path?: string;
  metrics?: {
    luminance_mean?: number;
    luminance_stddev?: number;
    regions?: Record<string, {
      luminance_mean?: number;
      luminance_stddev?: number;
    }>;
    pixels?: Record<string, number>;
  };
  diff?: {
    changed_ratio?: number;
    rmse?: number;
    mean_abs_error?: number;
  };
}

interface QaReport {
  schema_version: number;
  overall_status: Status;
  summary_path: string;
  bench: Record<string, unknown>;
  scenes: QaSceneReport[];
  failures: string[];
}

interface QaSceneReport {
  id: string;
  checkpoint: string;
  status: Status;
  screenshots: QaScreenshotReport[];
  probes: QaProbeResult[];
  timing: QaTimingResult[];
  failures: string[];
}

interface QaScreenshotReport {
  id: string;
  name: string;
  path: string;
  status: Status;
  baseline_path?: string;
  failure?: string;
}

interface QaProbeResult {
  id: string;
  probe_type: string;
  screenshot: string;
  status: Status;
  observed?: number;
  expected: string;
  failure?: string;
}

interface QaTimingResult {
  id: string;
  area: string;
  field: string;
  status: Status;
  observed_ms?: number;
  max_ms: number;
  failure?: string;
}

interface CliArgs {
  config: string;
  summary: string;
  output?: string;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    config: "config/qa_visual.yaml",
    summary: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--config" && value) {
      args.config = value;
      i++;
    } else if (arg === "--summary" && value) {
      args.summary = value;
      i++;
    } else if (arg === "--output" && value) {
      args.output = value;
      i++;
    } else {
      throw new Error(`unknown or incomplete argument: ${arg}`);
    }
  }
  if (!args.summary) throw new Error("missing required --summary <path>");
  return args;
}

export function loadQaConfig(path: string): QaConfig {
  const parsed = load(readFileSync(path, "utf8")) as QaConfigFile;
  validateConfig(parsed.qa);
  return parsed.qa;
}

export function validateConfig(config: QaConfig): void {
  const sceneIds = new Set<string>();
  for (const scene of config.scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`duplicate QA scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    if (!scene.checkpoint) throw new Error(`scene ${scene.id} must name a checkpoint`);
    if (!scene.screenshots.length) throw new Error(`scene ${scene.id} must name screenshots`);
    const screenshotIds = new Set(scene.screenshots.map((screenshot) => screenshot.id));
    if (screenshotIds.size !== scene.screenshots.length) throw new Error(`duplicate screenshot id in scene ${scene.id}`);
    for (const probe of scene.probes ?? []) {
      if (!screenshotIds.has(probe.screenshot)) {
        throw new Error(`probe ${probe.id} references unknown screenshot ${probe.screenshot}`);
      }
      if ("region" in probe && !validRegion(probe.region)) throw new Error(`probe ${probe.id} has invalid region`);
      if ("pixel" in probe && !validPixel(probe.pixel)) throw new Error(`probe ${probe.id} has invalid pixel`);
    }
  }
}

export function runQa(config: QaConfig, summary: WebQaSummary, summaryPath: string, outputDir: string): QaReport {
  const scenes = config.scenes.map((scene) => evaluateScene(config, scene, summary));
  const failures = scenes.flatMap((scene) => scene.failures.map((failure) => `${scene.id}: ${failure}`));
  const baselineMissing = scenes.some((scene) => scene.status === "baseline_missing");
  const overall_status: Status = failures.length ? "fail" : baselineMissing ? "baseline_missing" : "pass";
  const report: QaReport = {
    schema_version: 1,
    overall_status,
    summary_path: summaryPath,
    bench: {
      scene: summary.scene,
      git_sha: summary.git_sha ?? null,
      git_dirty: summary.git_dirty ?? null,
      build_profile: summary.build_profile ?? "web",
      platform: summary.platform ?? "web",
      run_started_utc: summary.run_started_utc ?? "",
      duration_secs: summary.duration_secs ?? 0,
    },
    scenes,
    failures,
  };
  writeReport(report, config, outputDir);
  return report;
}

function evaluateScene(config: QaConfig, scene: QaSceneConfig, summary: WebQaSummary): QaSceneReport {
  if (scene.bench_scene && !sceneMatches(summary.scene, scene.bench_scene)) {
    return {
      id: scene.id,
      checkpoint: scene.checkpoint,
      status: "fail",
      screenshots: [],
      probes: [],
      timing: [],
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
  const failures = [
    ...screenshots.flatMap((screenshot) => screenshot.failure ? [`screenshot ${screenshot.id}: ${screenshot.failure}`] : []),
    ...probes.flatMap((probe) => probe.failure ? [`probe ${probe.id}: ${probe.failure}`] : []),
    ...timing.flatMap((result) => result.failure ? [`timing ${result.id}: ${result.failure}`] : []),
  ];
  const status: Status = failures.length ? "fail" : screenshots.some((screenshot) => screenshot.status === "baseline_missing") ? "baseline_missing" : "pass";
  return { id: scene.id, checkpoint: scene.checkpoint, status, screenshots, probes, timing, failures };
}

function evaluateScreenshot(
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

function evaluateProbe(probe: QaProbeConfig, screenshotsById: Map<string, WebQaScreenshot>): QaProbeResult {
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

function evaluateTiming(config: QaConfig, checkpoint: WebQaCheckpoint, threshold: QaTimingThreshold): QaTimingResult {
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

function metricValue(checkpoint: WebQaCheckpoint, area: string, field: string): number | undefined {
  if (area === "__frame") {
    if (field === "median_ms" || field === "avg_ms") return checkpoint.median_frame_ms;
    if (field === "p95_ms") return checkpoint.p95_frame_ms;
    if (field === "p99_ms") return checkpoint.p99_frame_ms;
    return undefined;
  }
  return checkpoint.areas?.[area]?.[field];
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

function writeReport(report: QaReport, config: QaConfig, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, config.report_json_name ?? "qa-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(resolve(outputDir, config.report_markdown_name ?? "qa-report.md"), renderMarkdown(report));
}

function renderMarkdown(report: QaReport): string {
  const lines = [
    "# clod-poc QA Report",
    "",
    `Overall status: **${report.overall_status}**`,
    "",
    `- Summary: \`${report.summary_path}\``,
    `- Scene: \`${String(report.bench.scene)}\``,
    "",
    "## Scenes",
    "",
    "| scene | checkpoint | status | screenshots | probes | timing |",
    "|---|---|---|---:|---:|---:|",
  ];
  for (const scene of report.scenes) {
    lines.push(`| ${scene.id} | ${scene.checkpoint} | ${scene.status} | ${scene.screenshots.length} | ${scene.probes.length} | ${scene.timing.length} |`);
  }
  if (report.failures.length) {
    lines.push("", "## Failures", "");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  return `${lines.join("\n")}\n`;
}

function validRegion(region: readonly number[]): boolean {
  return region.length === 4 && region.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) && region[0] < region[2] && region[1] < region[3];
}

function validPixel(pixel: readonly number[]): boolean {
  return pixel.length === 2 && pixel.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(args.config);
  const summaryPath = resolve(args.summary);
  const config = loadQaConfig(configPath);
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as WebQaSummary;
  const outputDir = resolve(args.output ?? `${config.output_root ?? "qa-runs"}/latest`);
  const report = runQa(config, summary, args.summary, outputDir);
  console.log(`[QA] overall_status=${report.overall_status}`);
  if (report.overall_status === "fail") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error("[QA] error:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export const testOnly = {
  evaluateProbe,
  evaluateTiming,
  metricValue,
};
