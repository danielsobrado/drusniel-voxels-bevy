import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface P0Summary {
  cases?: P0Case[];
}

interface P0Case {
  name?: string;
  status?: string;
  contaminated?: boolean;
  renderer?: string;
  finalCounters?: Record<string, number>;
  metrics?: Record<string, number | null>;
}

const COUNTERS = {
  totalPixels: "naadf.farSummaryAtlas.upload.totalPixels",
  dirtyPixels: "naadf.farSummaryAtlas.upload.dirtyPixels",
  dirtyPct: "naadf.farSummaryAtlas.upload.dirtyPct",
  modeCode: "naadf.farSummaryAtlas.upload.modeCode",
  fallbackReasonCode: "naadf.farSummaryAtlas.upload.fallbackReasonCode",
  thresholdPct: "naadf.farSummaryAtlas.upload.thresholdPct",
  rawDirtyRects: "naadf.farSummaryAtlas.upload.rawDirtyRects",
  mergedDirtyRects: "naadf.farSummaryAtlas.upload.mergedDirtyRects",
  rawDirtyPixels: "naadf.farSummaryAtlas.upload.rawDirtyPixels",
  mergedDirtyPixels: "naadf.farSummaryAtlas.upload.mergedDirtyPixels",
  changedTiles: "naadf.farSummaryAtlas.upload.changedTiles",
  clearedRects: "naadf.farSummaryAtlas.upload.clearedRects",
  blitRects: "naadf.farSummaryAtlas.upload.blitRects",
  windowShiftTilesX: "naadf.farSummaryAtlas.upload.windowShiftTilesX",
  windowShiftTilesZ: "naadf.farSummaryAtlas.upload.windowShiftTilesZ",
  dirtyUploads: "naadf.farSummaryAtlas.upload.dirtyUploads",
  fullUploads: "naadf.farSummaryAtlas.upload.fullUploads",
  exerciseStatus: "p0DirtyAtlasExercise.status",
  exerciseMove: "p0DirtyAtlasExercise.moveM",
  requestedMove: "p0DirtyAtlasExercise.requestedMoveM",
  tileSpan: "p0DirtyAtlasExercise.tileSpanM",
  boundaryEpsilon: "p0DirtyAtlasExercise.boundaryEpsilonM",
} as const;

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function numberFromCase(testCase: P0Case, key: string): number | null {
  const raw = testCase.finalCounters?.[key] ?? testCase.metrics?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  return value.toFixed(2);
}

function readSummary(path: string): P0Summary {
  if (!existsSync(path)) throw new Error(`summary file not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as P0Summary;
}

function diagnosis(testCase: P0Case): string {
  const total = numberFromCase(testCase, COUNTERS.totalPixels) ?? 0;
  const merged = numberFromCase(testCase, COUNTERS.mergedDirtyPixels) ?? numberFromCase(testCase, COUNTERS.dirtyPixels) ?? 0;
  const raw = numberFromCase(testCase, COUNTERS.rawDirtyPixels) ?? merged;
  const threshold = numberFromCase(testCase, COUNTERS.thresholdPct) ?? 0;
  const fallback = numberFromCase(testCase, COUNTERS.fallbackReasonCode);
  const mode = numberFromCase(testCase, COUNTERS.modeCode);
  const rawPct = total > 0 ? raw / total : 0;
  const mergedPct = total > 0 ? merged / total : 0;

  if (mode === 1 && fallback === 0) return "dirty upload path proved";
  if (fallback === 5 && rawPct > threshold) return "raw dirty area already exceeds threshold";
  if (fallback === 5 && rawPct <= threshold && mergedPct > threshold) return "merge expansion crosses threshold";
  if (fallback === 4) return "too many dirty rects";
  if (fallback === 7) return "texture partial ranges unsupported";
  if (fallback === 1) return "initial full upload";
  return "needs inspection";
}

function markdown(summaryPath: string, summary: P0Summary): string {
  const cases = summary.cases ?? [];
  const lines = [
    "# CLOD-POC P0 Atlas Dirty Upload Diagnostics",
    "",
    `Source: \`${summaryPath}\``,
    "",
    "| case | status | contaminated | renderer | mode | fallback | dirty/full | dirty pixels/total | dirty pct | threshold | raw rects | merged rects | raw pixels | merged pixels | changed tiles | clear/blit | window shift X/Z | exercise move/request/tile/eps | diagnosis |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const testCase of cases) {
    lines.push(
      `| ${testCase.name ?? "unknown"} | ` +
        `${testCase.status ?? "-"} | ` +
        `${testCase.contaminated ? "yes" : "no"} | ` +
        `${testCase.renderer ?? "-"} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.modeCode))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.fallbackReasonCode))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.dirtyUploads))}/${fmt(numberFromCase(testCase, COUNTERS.fullUploads))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.dirtyPixels))}/${fmt(numberFromCase(testCase, COUNTERS.totalPixels))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.dirtyPct))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.thresholdPct))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.rawDirtyRects))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.mergedDirtyRects))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.rawDirtyPixels))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.mergedDirtyPixels))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.changedTiles))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.clearedRects))}/${fmt(numberFromCase(testCase, COUNTERS.blitRects))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.windowShiftTilesX))}/${fmt(numberFromCase(testCase, COUNTERS.windowShiftTilesZ))} | ` +
        `${fmt(numberFromCase(testCase, COUNTERS.exerciseMove))}/${fmt(numberFromCase(testCase, COUNTERS.requestedMove))}/${fmt(numberFromCase(testCase, COUNTERS.tileSpan))}/${fmt(numberFromCase(testCase, COUNTERS.boundaryEpsilon))} | ` +
        `${diagnosis(testCase)} |`,
    );
  }

  lines.push(
    "",
    "## Codes",
    "",
    "- Upload mode: 0=none, 1=dirty, 2=full.",
    "- Fallback reason: 0=none, 1=initial, 2=explicit, 3=disabled, 4=too_many_rects, 5=threshold, 6=invalid_atlas, 7=partial_ranges_unsupported, 8=full_invalidation.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

const input = argValue("--summary") ?? process.argv[2] ?? "../../validation-artifacts/clod-poc-p0-smoke-3/summary.json";
const output = argValue("--out") ?? join(dirname(input), "atlas-diagnostics.md");
const summary = readSummary(input);
writeFileSync(output, markdown(input, summary));
console.log(`[perf-p0-atlas-diagnostics] wrote ${output}`);
