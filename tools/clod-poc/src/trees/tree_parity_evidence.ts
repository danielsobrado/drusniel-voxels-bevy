export type TreeParityEvidenceArtifact = "image" | "stats" | "perf" | "notes";

export interface TreeParityEvidenceArtifactSet {
  image?: string;
  stats?: string;
  perf?: string;
  notes?: string;
}

export interface TreeParityEvidenceMetricRule {
  artifact: "stats" | "perf";
  path: string;
  min?: number;
  max?: number;
  equals?: number | string | boolean | null;
  present?: boolean;
  nonZero?: boolean;
}

export interface TreeParityCaptureConfig {
  scene?: string;
  camera?: string;
  params?: Record<string, string | number | boolean>;
  perfCase?: string;
  world?: number;
  width?: number;
  height?: number;
  settleFrames?: number;
  warmupFrames?: number;
  sampleFrames?: number;
  timeoutMs?: number;
}

export interface TreeParityEvidenceCapture {
  id: string;
  description?: string;
  artifacts?: TreeParityEvidenceArtifactSet;
  capture?: TreeParityCaptureConfig;
  metrics?: TreeParityEvidenceMetricRule[];
}

export interface TreeParityEvidenceManifest {
  captures: TreeParityEvidenceCapture[];
}

export interface TreeParityEvidenceFileInfo {
  exists: boolean;
  sizeBytes: number;
}

export interface TreeParityEvidenceInput {
  manifest: TreeParityEvidenceManifest;
  fileInfo(path: string): TreeParityEvidenceFileInfo;
  readJson(path: string): unknown;
}

export interface TreeParityEvidenceFailure {
  captureId: string;
  message: string;
}

export interface TreeParityEvidenceResult {
  ok: boolean;
  failures: TreeParityEvidenceFailure[];
}

export interface TreeParityCaptureCommandOptions {
  baseUrl?: string;
  renderer?: "webgpu" | "webgl";
  world?: number;
  width?: number;
  height?: number;
  settleFrames?: number;
  warmupFrames?: number;
  sampleFrames?: number;
  timeoutMs?: number;
}

export interface TreeParityCaptureCommandSet {
  captureId: string;
  screenshotCommand: string | null;
  perfCommand: string | null;
}

export interface TreeParityEvidenceReportOptions {
  generatedAt?: string;
  title?: string;
}

const DEFAULT_CAPTURE_OPTIONS: Required<TreeParityCaptureCommandOptions> = {
  baseUrl: "http://127.0.0.1:5180/",
  renderer: "webgpu",
  world: 8,
  width: 1920,
  height: 1080,
  settleFrames: 180,
  warmupFrames: 240,
  sampleFrames: 900,
  timeoutMs: 240000,
};

const TREE_PARITY_SUPPORTED_CAPTURE_PARAMS = new Set([
  "treeGpu",
  "treeGpuRing",
  "webgpuSelection",
  "freeze",
  "sunElevationDeg",
  "sunElevation",
  "sunAzimuthDeg",
  "sunAzimuth",
  "treeDistance",
  "treeDistanceM",
  "treeGpuMaxVisible",
  "treeGpuMax",
  "treeMaxInstances",
  "treeMax",
  "trees",
  "understory",
  "grass",
  "stones",
  "water",
  "weather",
  "postProcess",
  "postprocess",
  "terrainMaterial",
  "terrainTriplanar",
  "farShell",
  "clodPerf",
  "clodShadowOverlay",
  "clodShadowProxy",
  "profile",
]);

export function validateTreeParityEvidence(input: TreeParityEvidenceInput): TreeParityEvidenceResult {
  const failures: TreeParityEvidenceFailure[] = validateTreeParityManifestCaptureConfig(input.manifest);
  for (const capture of input.manifest.captures) {
    validateCaptureFiles(capture, input, failures);
    validateCaptureMetrics(capture, input, failures);
  }
  return { ok: failures.length === 0, failures };
}

export function validateTreeParityManifestCaptureConfig(manifest: TreeParityEvidenceManifest): TreeParityEvidenceFailure[] {
  const failures: TreeParityEvidenceFailure[] = [];
  for (const capture of manifest.captures) {
    for (const key of Object.keys(capture.capture?.params ?? {})) {
      if (!TREE_PARITY_SUPPORTED_CAPTURE_PARAMS.has(key)) {
        failures.push({ captureId: capture.id, message: `unsupported capture param: ${key}` });
      }
    }
    if (capture.artifacts?.perf && !capture.capture?.perfCase) {
      failures.push({ captureId: capture.id, message: "perf artifact requires capture.perfCase" });
    }
    if (capture.capture?.perfCase && !capture.artifacts?.perf) {
      failures.push({ captureId: capture.id, message: "capture.perfCase requires perf artifact" });
    }
  }
  return failures;
}

export function buildTreeParityCaptureCommands(
  manifest: TreeParityEvidenceManifest,
  options: TreeParityCaptureCommandOptions = {},
): TreeParityCaptureCommandSet[] {
  const manifestFailures = validateTreeParityManifestCaptureConfig(manifest);
  if (manifestFailures.length > 0) throw new Error(formatManifestFailures(manifestFailures));
  const defaults = { ...DEFAULT_CAPTURE_OPTIONS, ...options };
  return manifest.captures.map((capture) => buildCaptureCommandSet(capture, defaults));
}

export function buildTreeParityEvidenceMarkdownReport(
  input: TreeParityEvidenceInput,
  options: TreeParityEvidenceReportOptions = {},
): string {
  const result = validateTreeParityEvidence(input);
  const lines = [
    `# ${options.title ?? "clod-poc tree parity evidence"}`,
    "",
    `Generated: ${options.generatedAt ?? new Date().toISOString()}`,
    `Status: ${result.ok ? "PASS" : "FAIL"}`,
    `Captures: ${input.manifest.captures.length}`,
    "",
    "## Captures",
    "",
  ];

  for (const capture of input.manifest.captures) {
    lines.push(`### ${capture.id}`, "");
    if (capture.description) lines.push(capture.description, "");
    lines.push("| artifact | path | status |", "| --- | --- | --- |");
    for (const [artifact, path] of Object.entries(capture.artifacts ?? {}) as [TreeParityEvidenceArtifact, string][]) {
      const info = input.fileInfo(path);
      lines.push(`| ${artifact} | ${path} | ${artifactStatus(info)} |`);
    }
    lines.push("", "| metric | expected | actual |", "| --- | --- | ---: |");
    for (const rule of capture.metrics ?? []) {
      lines.push(metricReportRow(capture, rule, input));
    }
    lines.push("");
  }

  if (result.failures.length > 0) {
    lines.push("## Failures", "");
    for (const failure of result.failures) lines.push(`- ${failure.captureId}: ${failure.message}`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function buildCaptureCommandSet(
  capture: TreeParityEvidenceCapture,
  defaults: Required<TreeParityCaptureCommandOptions>,
): TreeParityCaptureCommandSet {
  const config = capture.capture ?? {};
  const params = stringifyParams({
    treeGpu: "1",
    webgpuSelection: "1",
    freeze: "1",
    ...(config.params ?? {}),
  });
  const world = config.world ?? defaults.world;
  const width = config.width ?? defaults.width;
  const height = config.height ?? defaults.height;
  const timeoutMs = config.timeoutMs ?? defaults.timeoutMs;
  const screenshotCommand = capture.artifacts?.image && capture.artifacts?.stats
    ? [
      "npm --prefix tools/clod-poc run shoot --",
      `--scene ${shellArg(config.scene ?? "trees-perf")}`,
      `--renderer ${defaults.renderer}`,
      `--out ${shellArg(capture.artifacts.image)}`,
      `--stats ${shellArg(capture.artifacts.stats)}`,
      `--w ${width}`,
      `--h ${height}`,
      `--settle ${config.settleFrames ?? defaults.settleFrames}`,
      `--timeout ${timeoutMs}`,
      "--hud",
      `--world ${world}`,
      config.camera ? `--cam ${shellArg(config.camera)}` : "",
      ...params.map(([key, value]) => `--${key} ${shellArg(value)}`),
    ].filter(Boolean).join(" ")
    : null;

  const perfCommand = capture.artifacts?.perf && config.perfCase
    ? [
      "npm --prefix tools/clod-poc run perf:main --",
      `--baseUrl ${shellArg(defaults.baseUrl)}`,
      `--world ${world}`,
      `--warmup ${config.warmupFrames ?? defaults.warmupFrames}`,
      `--frames ${config.sampleFrames ?? defaults.sampleFrames}`,
      `--timeout ${timeoutMs}`,
      `--renderer ${defaults.renderer}`,
      `--freeze ${String(params.find(([key]) => key === "freeze")?.[1] ?? "1")}`,
      `--case ${shellArg(config.perfCase)}`,
      `--out ${shellArg(perfOutputDirectory(capture.artifacts.perf, config.perfCase))}`,
      params.length > 0 ? `--params ${shellArg(params.map(([key, value]) => `${key}=${value}`).join(","))}` : "",
    ].filter(Boolean).join(" ")
    : null;

  return { captureId: capture.id, screenshotCommand, perfCommand };
}

function validateCaptureFiles(
  capture: TreeParityEvidenceCapture,
  input: TreeParityEvidenceInput,
  failures: TreeParityEvidenceFailure[],
): void {
  for (const [artifact, path] of Object.entries(capture.artifacts ?? {}) as [TreeParityEvidenceArtifact, string][]) {
    if (!path) continue;
    const info = input.fileInfo(path);
    if (!info.exists) {
      failures.push({ captureId: capture.id, message: `${artifact} artifact is missing: ${path}` });
      continue;
    }
    if (info.sizeBytes <= 0) failures.push({ captureId: capture.id, message: `${artifact} artifact is empty: ${path}` });
  }
}

function validateCaptureMetrics(
  capture: TreeParityEvidenceCapture,
  input: TreeParityEvidenceInput,
  failures: TreeParityEvidenceFailure[],
): void {
  const jsonCache: Partial<Record<"stats" | "perf", unknown>> = {};
  for (const rule of capture.metrics ?? []) {
    const path = capture.artifacts?.[rule.artifact];
    if (!path) {
      failures.push({ captureId: capture.id, message: `metric ${rule.path} has no ${rule.artifact} artifact configured` });
      continue;
    }
    try {
      jsonCache[rule.artifact] ??= input.readJson(path);
    } catch (error) {
      failures.push({ captureId: capture.id, message: `cannot read ${rule.artifact} JSON ${path}: ${errorMessage(error)}` });
      continue;
    }
    const value = getPath(jsonCache[rule.artifact], rule.path);
    validateMetricRule(capture.id, rule, value, failures);
  }
}

function validateMetricRule(
  captureId: string,
  rule: TreeParityEvidenceMetricRule,
  value: unknown,
  failures: TreeParityEvidenceFailure[],
): void {
  if (rule.present !== false && value === undefined) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} is missing` });
    return;
  }
  if (rule.present === false) return;
  if (rule.equals !== undefined && value !== rule.equals) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected ${String(rule.equals)}, got ${String(value)}` });
  }
  if (rule.nonZero && numericValue(value) === 0) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected non-zero, got ${String(value)}` });
  }
  if (rule.min !== undefined && numericValue(value) < rule.min) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected >= ${rule.min}, got ${String(value)}` });
  }
  if (rule.max !== undefined && numericValue(value) > rule.max) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected <= ${rule.max}, got ${String(value)}` });
  }
}

function metricReportRow(
  capture: TreeParityEvidenceCapture,
  rule: TreeParityEvidenceMetricRule,
  input: TreeParityEvidenceInput,
): string {
  const path = capture.artifacts?.[rule.artifact];
  if (!path) return `| ${rule.artifact}.${rule.path} | ${metricExpectation(rule)} | missing ${rule.artifact} artifact |`;
  try {
    const source = input.readJson(path);
    const value = getPath(source, rule.path);
    return `| ${rule.artifact}.${rule.path} | ${metricExpectation(rule)} | ${formatMetricValue(value)} |`;
  } catch (error) {
    return `| ${rule.artifact}.${rule.path} | ${metricExpectation(rule)} | ${errorMessage(error)} |`;
  }
}

function getPath(source: unknown, path: string): unknown {
  let current = source;
  for (const segment of path.split(".")) {
    if (!segment) continue;
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function numericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringifyParams(params: Record<string, string | number | boolean>): [string, string][] {
  return Object.entries(params)
    .filter(([, value]) => value !== false && value !== "")
    .map(([key, value]) => [key, value === true ? "1" : String(value)]);
}

function perfOutputDirectory(perfArtifact: string, perfCase: string): string {
  const suffix = `/${perfCase}.json`;
  return perfArtifact.endsWith(suffix) ? perfArtifact.slice(0, -suffix.length) : perfArtifact.replace(/\.json$/i, "");
}

function formatManifestFailures(failures: readonly TreeParityEvidenceFailure[]): string {
  return [
    "Invalid tree parity evidence manifest:",
    ...failures.map((failure) => `- ${failure.captureId}: ${failure.message}`),
  ].join("\n");
}

function artifactStatus(info: TreeParityEvidenceFileInfo): string {
  if (!info.exists) return "missing";
  if (info.sizeBytes <= 0) return "empty";
  return `${info.sizeBytes} bytes`;
}

function metricExpectation(rule: TreeParityEvidenceMetricRule): string {
  const parts: string[] = [];
  if (rule.equals !== undefined) parts.push(`= ${String(rule.equals)}`);
  if (rule.nonZero) parts.push("non-zero");
  if (rule.min !== undefined) parts.push(`>= ${rule.min}`);
  if (rule.max !== undefined) parts.push(`<= ${rule.max}`);
  if (rule.present === false) parts.push("absent");
  return parts.length > 0 ? parts.join(", ") : "present";
}

function formatMetricValue(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
