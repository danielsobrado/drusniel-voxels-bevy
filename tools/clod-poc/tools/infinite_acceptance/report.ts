import type { ThresholdEvaluation } from "./thresholds.js";

export interface SceneReportInput {
  name: string;
  screenshot: string;
  stats: Record<string, unknown>;
  thresholds: ThresholdEvaluation;
  failures: string[];
  passed: boolean;
}

export function aggregatePassed(scenes: Pick<SceneReportInput, "passed">[], failures: string[]): boolean {
  return failures.length === 0 && scenes.every((scene) => scene.passed);
}

function num(values: Record<string, number>, key: string): string {
  const value = values[key];
  return value === undefined ? "n/a" : value.toFixed(key.includes("tris") ? 0 : 2);
}

export function renderMarkdownReport(input: {
  passed: boolean;
  scenes: SceneReportInput[];
  failures: string[];
  reportJsonPath: string;
}): string {
  const lines = [
    `# Infinite Islands Acceptance`,
    ``,
    `Result: ${input.passed ? "PASS" : "FAIL"}`,
    ``,
    `| scene | p95 | p99 | draw calls | terrain tris | far shell tris | holes | missing pages | pass | screenshot |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |`,
  ];
  for (const scene of input.scenes) {
    const v = scene.thresholds.values;
    const holes = (v["ring_boundary_holes"] ?? 0) + (v["live_clod_gap_holes"] ?? 0) + (v["clod_far_gap_holes"] ?? 0);
    lines.push(`| ${scene.name} | ${num(v, "frame_ms_p95")} | ${num(v, "frame_ms_p99")} | ${num(v, "draw_calls")} | ${num(v, "rendered_terrain_tris")} | ${num(v, "far_shell_tris")} | ${holes} | ${num(v, "missing_clod_pages_in_required_radius")} | ${scene.passed ? "PASS" : "FAIL"} | ${scene.screenshot} |`);
  }
  if (input.failures.length > 0) {
    lines.push(``, `## Failures`);
    for (const failure of input.failures) lines.push(`- ${failure}`);
  }
  lines.push(``, `JSON: ${input.reportJsonPath}`, ``);
  return lines.join("\n");
}
