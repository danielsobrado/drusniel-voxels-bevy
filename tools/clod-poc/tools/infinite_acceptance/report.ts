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
  configuredWorldPages?: number;
  startupWorldPages?: number;
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

function sceneCounters(scene: SceneReportInput): Record<string, number> {
  const counters = scene.stats["counters"];
  return counters && typeof counters === "object" ? counters as Record<string, number> : {};
}

function counterValue(counters: Readonly<Record<string, number>>, key: string): number | undefined {
  const value = counters[key];
  return Number.isFinite(value) ? value : undefined;
}


function derivedSelectionSplit(scene: SceneReportInput): string {
  const counters = sceneCounters(scene);
  const update = counterValue(counters, "framePerf.p95.selectionUpdateMs");
  const core = counterValue(counters, "framePerf.p95.selectionMs");
  if (update === undefined || core === undefined) return "n/a";
  const stream = Math.max(0, update - core);
  return `stream:${stream.toFixed(1)}<br>core:${core.toFixed(1)}<br>total:${update.toFixed(1)}`;
}

function topPerfBuckets(scene: SceneReportInput, limit = 5): string {
  const counters = sceneCounters(scene);
  const entries = Object.entries(counters)
    .filter(([key, value]) => key.startsWith("framePerf.p95.") && Number.isFinite(value) && value > 0)
    .map(([key, value]) => ({ name: key.slice("framePerf.p95.".length), value }))
    .filter((entry) => !entry.name.startsWith("topBroad.") && !entry.name.startsWith("topProp."))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  return entries.length === 0 ? "n/a" : entries.map((entry) => `${entry.name}:${entry.value.toFixed(1)}`).join("<br>");
}

function perfScale(scene: SceneReportInput): string {
  const counters = sceneCounters(scene);
  const avg = counterValue(counters, "framePerf.dynamicResolutionRenderScaleAvg") ?? counterValue(counters, "dynamicResolution.renderScale");
  const active = counterValue(counters, "dynamicResolution.active");
  if (avg === undefined) return "n/a";
  return active === undefined ? avg.toFixed(2) : `${avg.toFixed(2)} / ${active}`;
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
    `| scene | p95 | p99 | perf scale/active | selection split p95 | top perf p95 buckets | draw calls | terrain tris | far shell tris | world | cache | build ms | summary ms | startup ms | holes | missing pages | pass | screenshot |`,
    `| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |`,
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
    const worldLabel = scene.configuredWorldPages !== undefined && scene.startupWorldPages !== undefined
      ? `${scene.configuredWorldPages}->${scene.startupWorldPages}`
      : "n/a";
    lines.push(`| ${scene.name} | ${num(v, "frame_ms_p95")} | ${num(v, "frame_ms_p99")} | ${perfScale(scene)} | ${derivedSelectionSplit(scene)} | ${topPerfBuckets(scene)} | ${num(v, "draw_calls")} | ${num(v, "rendered_terrain_tris")} | ${num(v, "far_shell_tris")} | ${worldLabel} | ${cacheLabel} | ${cache?.startupBuildWorldMs.toFixed(1) ?? "n/a"} | ${cache?.startupTerrainSummaryMs.toFixed(1) ?? "n/a"} | ${cache?.startupTotalMs.toFixed(1) ?? "n/a"} | ${holes} | ${num(v, "missing_clod_pages_in_required_radius")} | ${scene.passed ? "PASS" : "FAIL"} | ${scene.screenshot} |`);
  }
  if (input.failures.length > 0) {
    lines.push(``, `## Failures`);
    for (const failure of input.failures) lines.push(`- ${failure}`);
  }
  lines.push(``, `JSON: ${input.reportJsonPath}`, ``);
  return lines.join("\n");
}
