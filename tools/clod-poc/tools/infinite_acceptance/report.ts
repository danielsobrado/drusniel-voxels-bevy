import type { ThresholdEvaluation } from "./thresholds.js";

export interface SceneReportInput {
  name: string;
  screenshot: string;
  stats: Record<string, unknown>;
  cache?: {
    clodCacheHit: number;
    clodCacheMiss: number;
    clodCacheRehydrateMs: number;
    terrainSummaryCacheHit: number;
    terrainSummaryCacheMiss: number;
    startupBuildWorldMs: number;
    startupTerrainSummaryMs: number;
    startupTotalMs: number;
  };
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
    `| scene | p95 | p99 | draw calls | terrain tris | far shell tris | cache | build ms | summary ms | startup ms | holes | missing pages | pass | screenshot |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |`,
  ];
  for (const scene of input.scenes) {
    const v = scene.thresholds.values;
    const cache = scene.cache;
    const cacheLabel = !cache
      ? "n/a"
      : cache.clodCacheHit === 1 && cache.terrainSummaryCacheHit === 1
        ? "hit"
        : cache.clodCacheMiss === 1 || cache.terrainSummaryCacheMiss === 1
          ? "miss"
          : "partial";
    const holes = (v["ring_boundary_holes"] ?? 0) + (v["live_clod_gap_holes"] ?? 0) + (v["clod_far_gap_holes"] ?? 0);
    lines.push(`| ${scene.name} | ${num(v, "frame_ms_p95")} | ${num(v, "frame_ms_p99")} | ${num(v, "draw_calls")} | ${num(v, "rendered_terrain_tris")} | ${num(v, "far_shell_tris")} | ${cacheLabel} | ${cache?.startupBuildWorldMs.toFixed(1) ?? "n/a"} | ${cache?.startupTerrainSummaryMs.toFixed(1) ?? "n/a"} | ${cache?.startupTotalMs.toFixed(1) ?? "n/a"} | ${holes} | ${num(v, "missing_clod_pages_in_required_radius")} | ${scene.passed ? "PASS" : "FAIL"} | ${scene.screenshot} |`);
  }
  if (input.failures.length > 0) {
    lines.push(``, `## Failures`);
    for (const failure of input.failures) lines.push(`- ${failure}`);
  }
  lines.push(``, `JSON: ${input.reportJsonPath}`, ``);
  return lines.join("\n");
}
