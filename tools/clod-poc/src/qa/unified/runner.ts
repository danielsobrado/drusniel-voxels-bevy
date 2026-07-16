import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { WebQaCheckpoint, WebQaSummary } from "../qaTypes.js";
import { evaluateCounterGates, readInformationalMetrics } from "./counters.js";
import { loadLinearImage, loadMask } from "./image_linear.js";
import { compareImages, writeImageArtifacts } from "./image_metrics.js";
import { loadUnifiedRegistry, reproductionCommand, selectScenes, type ManifestPaths } from "./manifest.js";
import { evaluateRegionProbe } from "./region_probes.js";
import { writeUnifiedReports, type UnifiedQaReport, type UnifiedSceneReport, type UnifiedStatus } from "./report.js";
import { evaluateTimingGates } from "./timing.js";
import type { UnifiedQaScene } from "./schema.js";

export interface UnifiedRunOptions {
  manifests: ManifestPaths;
  summary: WebQaSummary;
  summaryPath: string;
  outputDir: string;
  tags?: string[];
  sceneIds?: string[];
  actualRoot?: string;
}

export async function runUnifiedQa(options: UnifiedRunOptions): Promise<UnifiedQaReport> {
  const registry = loadUnifiedRegistry(options.manifests);
  const scenes = selectScenes(registry, options.tags, options.sceneIds);
  const repositoryRoot = resolve(dirname(options.manifests.visual), "../..");
  const reports: UnifiedSceneReport[] = [];
  for (const scene of scenes) reports.push(await evaluateScene(scene, options, repositoryRoot));
  const failures = reports.flatMap((scene) => scene.failures.map((failure) => `${scene.id}: ${failure}`));
  const authoritative = options.summary.git_dirty !== true;
  let status: UnifiedStatus = failures.length > 0 ? "FAIL" : reports.some((scene) => scene.status === "BASELINE_MISSING") ? "BASELINE_MISSING" : "PASS";
  if (!authoritative && status === "PASS") status = "NON_AUTHORITATIVE";
  const report: UnifiedQaReport = {
    schema_version: 1,
    status,
    generated_utc: new Date().toISOString(),
    authoritative,
    manifest_paths: [options.manifests.visual, options.manifests.performance],
    summary_path: options.summaryPath,
    scenes: reports,
    failures,
  };
  writeUnifiedReports(report, options.outputDir);
  return report;
}

async function evaluateScene(scene: UnifiedQaScene, options: UnifiedRunOptions, repositoryRoot: string): Promise<UnifiedSceneReport> {
  const checkpoint = findCheckpoint(options.summary, scene.capture.checkpoint);
  if (!checkpoint) return missingCheckpoint(scene);
  const timing = evaluateTimingGates(checkpoint, scene.timing_gates);
  const counters = evaluateCounterGates(checkpoint, scene.counter_gates);
  const informational = readInformationalMetrics(checkpoint, scene.informational_metrics);
  const failures = [
    ...timing.flatMap((result) => result.failure ? [result.failure] : []),
    ...counters.flatMap((result) => result.failure ? [result.failure] : []),
  ];
  const regions = [];
  let image: Record<string, number | string | boolean | null> | undefined;
  let baselineMissing = false;
  const actualPath = findActualImage(checkpoint, scene, options.actualRoot);
  const baselinePath = resolve(repositoryRoot, scene.baseline.image);
  if (actualPath && existsSync(actualPath)) {
    const actual = await loadLinearImage(actualPath);
    for (const probe of scene.region_probes) {
      const result = evaluateRegionProbe(actual, probe);
      regions.push(result);
      failures.push(...result.failures.map((failure) => `${probe.id}: ${failure}`));
    }
    if (existsSync(baselinePath)) {
      const baseline = await loadLinearImage(baselinePath);
      const mask = scene.baseline.mask ? await loadMask(resolve(repositoryRoot, scene.baseline.mask), actual.width, actual.height) : undefined;
      const comparison = compareImages(baseline, actual, scene.image_gates.changed_pixel_threshold, mask);
      const metrics = comparison.metrics;
      image = { ...metrics, baseline: baselinePath, actual: actualPath };
      if (scene.image_gates.required) {
        gateImage("mean absolute error", metrics.meanAbsoluteError, scene.image_gates.mean_absolute_error_max, failures);
        gateImage("p95 absolute error", metrics.p95AbsoluteError, scene.image_gates.p95_absolute_error_max, failures);
        gateImage("changed pixel fraction", metrics.changedPixelFraction, scene.image_gates.changed_pixel_fraction_max, failures);
        gateImage("edge error mean", metrics.edgeErrorMean, scene.image_gates.edge_error_mean_max, failures);
        gateImage("luminance mean delta", Math.abs(metrics.luminanceMeanActual - metrics.luminanceMeanBaseline), scene.image_gates.luminance_mean_delta_max, failures);
        gateImage("luminance stddev delta", Math.abs(metrics.luminanceStddevActual - metrics.luminanceStddevBaseline), scene.image_gates.luminance_stddev_delta_max, failures);
        gateImage("chroma mean delta", Math.abs(metrics.chromaMeanActual - metrics.chromaMeanBaseline), scene.image_gates.chroma_mean_delta_max, failures);
      }
      const sceneDir = resolve(options.outputDir, "scenes", scene.target, scene.id);
      await writeImageArtifacts(baseline, actual, comparison, {
        diff: resolve(sceneDir, "diff.png"), heatmap: resolve(sceneDir, "heatmap.png"), changedMask: resolve(sceneDir, "changed-mask.png"),
      });
    } else {
      baselineMissing = true;
      image = { baseline: baselinePath, actual: actualPath, baseline_missing: true };
      if (scene.image_gates.required) failures.push(`baseline image missing: ${baselinePath}`);
    }
  } else if (scene.image_gates.required) {
    failures.push(`actual image missing for ${scene.capture.image}`);
  }
  return {
    id: scene.id,
    target: scene.target,
    status: failures.length > 0 ? "FAIL" : baselineMissing ? "BASELINE_MISSING" : "PASS",
    reproductionCommand: reproductionCommand(scene),
    failures,
    timing,
    counters,
    informational,
    regions,
    ...(image ? { image } : {}),
  };
}

function findCheckpoint(summary: WebQaSummary, name: string): WebQaCheckpoint | null {
  return summary.checkpoints.find((checkpoint) => checkpoint.name === name) ?? null;
}
function findActualImage(checkpoint: WebQaCheckpoint, scene: UnifiedQaScene, actualRoot?: string): string | null {
  const screenshot = checkpoint.screenshots?.find((candidate) => candidate.id === scene.capture.image || candidate.name === scene.capture.image);
  if (!screenshot?.path) return null;
  return resolve(actualRoot ?? ".", screenshot.path);
}
function missingCheckpoint(scene: UnifiedQaScene): UnifiedSceneReport {
  const failure = `missing required checkpoint ${scene.capture.checkpoint}`;
  return { id: scene.id, target: scene.target, status: "FAIL", reproductionCommand: reproductionCommand(scene), failures: [failure], timing: [], counters: [], informational: [], regions: [] };
}
function gateImage(label: string, observed: number, max: number, failures: string[]): void { if (observed > max) failures.push(`${label} ${observed} > ${max}`); }
