import { validateTreeParityManifestCaptureConfig } from "./tree_parity_evidence_manifest.js";
import { formatManifestFailures, shellArg } from "./tree_parity_evidence_utils.js";
import type {
  TreeParityCaptureCommandOptions,
  TreeParityCaptureCommandSet,
  TreeParityEvidenceCapture,
  TreeParityEvidenceManifest,
} from "./tree_parity_evidence_types.js";

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

export function buildTreeParityCaptureCommands(
  manifest: TreeParityEvidenceManifest,
  options: TreeParityCaptureCommandOptions = {},
): TreeParityCaptureCommandSet[] {
  const manifestFailures = validateTreeParityManifestCaptureConfig(manifest);
  if (manifestFailures.length > 0) throw new Error(formatManifestFailures(manifestFailures));
  const defaults = { ...DEFAULT_CAPTURE_OPTIONS, ...options };
  return manifest.captures.map((capture) => buildCaptureCommandSet(capture, defaults));
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

function stringifyParams(params: Record<string, string | number | boolean>): [string, string][] {
  return Object.entries(params)
    .filter(([, value]) => value !== false && value !== "")
    .map(([key, value]) => [key, value === true ? "1" : String(value)]);
}

function perfOutputDirectory(perfArtifact: string, perfCase: string): string {
  const suffix = `/${perfCase}.json`;
  return perfArtifact.endsWith(suffix) ? perfArtifact.slice(0, -suffix.length) : perfArtifact.replace(/\.json$/i, "");
}
