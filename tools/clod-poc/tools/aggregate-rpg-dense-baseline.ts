/**
 * Aggregate D1c 5-run settled baselines under perf-runs/rpg-dense-baseline/.
 * Usage: npx tsx tools/aggregate-rpg-dense-baseline.ts
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface MetricStats {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
}

interface RunRow {
  run: string;
  caseName: string;
  frameMs: MetricStats;
  renderMs: MetricStats;
  topBroad: string;
  sampleCount: number;
  errors: number;
}

function loadSettledRuns(root: string, prefix: string): RunRow[] {
  const rows: RunRow[] = [];
  for (let i = 1; i <= 5; i++) {
    const dir = join(root, `${prefix}-run${i}`);
    const summaryPath = join(dir, "summary.json");
    if (!existsSync(summaryPath)) continue;
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const c = summary.cases?.[0];
    if (!c?.snapshot?.metrics) continue;
    const top = c.snapshot.broadBucketsByP95?.[0]?.name ?? "?";
    rows.push({
      run: `${prefix}-run${i}`,
      caseName: c.name,
      frameMs: c.snapshot.metrics.frameMs,
      renderMs: c.snapshot.metrics.renderMs,
      topBroad: top,
      sampleCount: c.snapshot.sampleCount,
      errors: Array.isArray(c.errors) ? c.errors.length : 0,
    });
  }
  return rows;
}

function loadMoveRuns(root: string): RunRow[] {
  const rows: RunRow[] = [];
  for (let i = 1; i <= 5; i++) {
    const dir = join(root, `move-run${i}`);
    const summaryPath = join(dir, "summary.json");
    if (!existsSync(summaryPath)) continue;
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const moving = summary.moving ?? summary.windows?.moving;
    const frameMs = moving?.phases?.frameMs ?? moving?.frameMs;
    const renderMs = moving?.phases?.renderMs ?? moving?.renderMs;
    if (!frameMs || !renderMs) continue;
    rows.push({
      run: `move-run${i}`,
      caseName: "rpg-dense-move",
      frameMs,
      renderMs,
      topBroad: "?",
      sampleCount: moving?.frames ?? 0,
      errors: 0,
    });
  }
  return rows;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function emptyAggregate() {
  return {
    runs: 0,
    frameMs: {
      p50_median: NaN,
      p50_worst: NaN,
      p95_median: NaN,
      p95_worst: NaN,
      max_worst: NaN,
      spread_p95: NaN,
    },
    renderMs: {
      p95_median: NaN,
      p95_worst: NaN,
    },
    rows: [] as RunRow[],
  };
}

function aggregate(rows: RunRow[]) {
  if (rows.length === 0) return emptyAggregate();
  const p50s = rows.map((r) => r.frameMs.p50);
  const p95s = rows.map((r) => r.frameMs.p95);
  const maxes = rows.map((r) => r.frameMs.max);
  const renderP95s = rows.map((r) => r.renderMs.p95);
  return {
    runs: rows.length,
    frameMs: {
      p50_median: median(p50s),
      p50_worst: Math.max(...p50s),
      p95_median: median(p95s),
      p95_worst: Math.max(...p95s),
      max_worst: Math.max(...maxes),
      spread_p95: Math.max(...p95s) - Math.min(...p95s),
    },
    renderMs: {
      p95_median: median(renderP95s),
      p95_worst: Math.max(...renderP95s),
    },
    rows,
  };
}

function sliceMarkdown(title: string, slice: ReturnType<typeof aggregate>): string[] {
  if (slice.runs === 0) {
    return [`## ${title}`, "", "runs: 0 (missing)", ""];
  }
  return [
    `## ${title}`,
    "",
    `runs: ${slice.runs}`,
    `- frameMs p50 median/worst: ${slice.frameMs.p50_median.toFixed(2)} / ${slice.frameMs.p50_worst.toFixed(2)}`,
    `- frameMs p95 median/worst/spread: ${slice.frameMs.p95_median.toFixed(2)} / ${slice.frameMs.p95_worst.toFixed(2)} / ${slice.frameMs.spread_p95.toFixed(2)}`,
    `- frameMs max worst: ${slice.frameMs.max_worst.toFixed(2)}`,
    `- renderMs p95 median/worst: ${slice.renderMs.p95_median.toFixed(2)} / ${slice.renderMs.p95_worst.toFixed(2)}`,
    "",
  ];
}

function main(): void {
  const root = join("perf-runs", "rpg-dense-baseline");
  const village = aggregate(loadSettledRuns(root, "village"));
  const base = aggregate(loadSettledRuns(root, "base"));
  const move = aggregate(loadMoveRuns(root));
  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    note: "p99/p99.9 not emitted by perf_probe today; reported p50/p95/max from probe + 5-run median/worst/spread.",
    village,
    base,
    move,
    dirsPresent: readdirSync(root).filter((name) => name.includes("run")),
  };
  writeFileSync(join(root, "aggregate.json"), JSON.stringify(out, null, 2));
  const md = [
    "# RPG dense baseline aggregate",
    "",
    `Generated ${out.generatedAt}`,
    "",
    ...sliceMarkdown("Village settled", village),
    ...sliceMarkdown("Player base settled", base),
    ...sliceMarkdown("Move route (village→forest→meadow)", move),
  ].join("\n");
  writeFileSync(join(root, "aggregate.md"), md);
  console.log(md);
}

main();
