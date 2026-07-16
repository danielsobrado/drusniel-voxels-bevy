import type { QaConfig, QaReport, Status, WebQaSummary } from "./qaTypes.js";
import { evaluateScene } from "./qaEvaluation.js";
import { writeReport } from "./qaReportWriter.js";

export function runQa(config: QaConfig, summary: WebQaSummary, summaryPath: string, outputDir: string): QaReport {
  const matchingScenes = config.scenes.filter((scene) => !scene.bench_scene || sceneMatches(summary.scene, scene.bench_scene));
  const scenes = (matchingScenes.length > 0 ? matchingScenes : config.scenes).map((scene) => evaluateScene(config, scene, summary));
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

function sceneMatches(summaryScene: string, configuredScene: string): boolean {
  const summary = normalizePath(summaryScene);
  const configured = normalizePath(configuredScene);
  return summary === configured || summary === configured.split("/").at(-1);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
