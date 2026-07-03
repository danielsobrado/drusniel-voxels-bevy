import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";

interface ParsedArgs {
  input: string;
  out: string | null;
  stdout: boolean;
  jsonOnly: boolean;
  markdownOnly: boolean;
  failOnFailure: boolean;
}

interface P0GateResult {
  name: string;
  status: string;
  detail: string;
}

interface P0GateSummary {
  status: string;
  failedCount: number;
  results: P0GateResult[];
}

interface P0CaseResult {
  name: string;
  status: string;
  renderer: string;
  attempts?: unknown[];
  warnings?: unknown[];
  errors?: unknown[];
  error?: string | null;
  metrics: Record<string, number | null | undefined>;
}

interface P0Summary {
  suite?: string;
  startedAt?: string;
  baseUrl?: string;
  renderer?: string;
  gates?: P0GateSummary;
  cases?: P0CaseResult[];
}

interface CompactCase {
  name: string;
  status: string;
  renderer: string;
  attempts: number | null;
  frameP50: number | null;
  frameP95: number | null;
  frameP99: number | null;
  vegP95: number | null;
  renderP95: number | null;
  warnings: number | null;
  errors: number | null;
  failure: string | null;
  evidence: Record<string, number | null>;
}

interface CompactSummary {
  suite: string | null;
  startedAt: string | null;
  baseUrl: string | null;
  renderer: string | null;
  gateStatus: string | null;
  failedGateCount: number;
  failedGates: P0GateResult[];
  gates: P0GateResult[];
  failedCases: CompactCase[];
  cases: CompactCase[];
}

const DEFAULT_INPUT = "perf-p0-webgpu";
const DEFAULT_OUT_BASENAME = "p0-extract";
const SELECTED_EVIDENCE_METRICS = [
  "terrainMaterialCacheHits",
  "terrainMaterialCacheMisses",
  "terrainMaterialCacheReady",
  "terrainMaterialCacheStale",
  "vegetationGpuClustersRejectedEarly",
  "vegetationGpuClustersAccepted",
  "vegetationGpuClustersSummaryMissing",
  "vegetationGpuSourceFarSummary",
  "vegetationGpuSourceTerrainSampler",
  "vegetationGpuSourceFallback",
  "vegetationGpuCandidatesBudgetBeforeReject",
  "vegetationGpuCandidatesBudgetAfterReject",
  "treeGpuPrefilterSourceFarSummaryAvg",
  "treeGpuPrefilterSourceTerrainSamplerAvg",
  "treeGpuPrefilterSourceFallbackAvg",
  "grassGpuPrefilterSourceFarSummaryAvg",
  "grassGpuPrefilterSourceTerrainSamplerAvg",
  "grassGpuPrefilterSourceFallbackAvg",
  "understoryGpuPrefilterSourceFarSummaryAvg",
  "understoryGpuPrefilterSourceTerrainSamplerAvg",
  "understoryGpuPrefilterSourceFallbackAvg",
  "p0DirtyAtlasExercise.enabled",
  "p0DirtyAtlasExercise.status",
  "p0DirtyAtlasExercise.moveM",
  "p0DirtyAtlasExercise.triggeredFrame",
  "p0DirtyAtlasExercise.resetFrame",
  "naadf.farSummaryAtlas.memorySavingsBytes",
  "naadf.farSummaryAtlas.memorySavingsPct",
  "naadf.farSummaryAtlas.upload.modeCode",
  "naadf.farSummaryAtlas.upload.dirtyUploads",
  "naadf.farSummaryAtlas.upload.fullUploads",
  "naadf.farSummaryAtlas.upload.dirtyPixels",
  "naadf.farSummaryAtlas.upload.totalPixels",
  "naadf.farSummaryAtlas.upload.dirtyPct",
] as const;

function parseArgs(argv: string[]): ParsedArgs {
  let input = DEFAULT_INPUT;
  let out: string | null = null;
  let stdout = false;
  let jsonOnly = false;
  let markdownOnly = false;
  let failOnFailure = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--stdout") {
      stdout = true;
      continue;
    }
    if (arg === "--json") {
      jsonOnly = true;
      continue;
    }
    if (arg === "--markdown") {
      markdownOnly = true;
      continue;
    }
    if (arg === "--failOnFailure") {
      failOnFailure = true;
      continue;
    }
    if (arg === "--out") {
      const next = argv[++i];
      if (!next) throw new Error("Missing value for --out");
      out = next;
      continue;
    }
    if (arg === "--input") {
      const next = argv[++i];
      if (!next) throw new Error("Missing value for --input");
      input = next;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    input = arg;
  }
  if (jsonOnly && markdownOnly) throw new Error("Use only one of --json or --markdown");
  return { input, out, stdout, jsonOnly, markdownOnly, failOnFailure };
}

function resolveSummaryPath(input: string): string {
  if (!existsSync(input)) throw new Error(`Input does not exist: ${input}`);
  const stat = statSync(input);
  if (stat.isDirectory()) {
    const summaryJson = join(input, "summary.json");
    if (existsSync(summaryJson)) return summaryJson;
    const summaryMd = join(input, "summary.md");
    if (existsSync(summaryMd)) return summaryMd;
    throw new Error(`Directory has no summary.json or summary.md: ${input}`);
  }
  return input;
}

function metric(metrics: Record<string, number | null | undefined>, name: string): number | null {
  const value = metrics[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactCase(input: P0CaseResult): CompactCase {
  const evidence: Record<string, number | null> = {};
  for (const key of SELECTED_EVIDENCE_METRICS) evidence[key] = metric(input.metrics, key);
  return {
    name: input.name,
    status: input.status,
    renderer: input.renderer,
    attempts: Array.isArray(input.attempts) ? input.attempts.length : null,
    frameP50: metric(input.metrics, "frameMs.p50"),
    frameP95: metric(input.metrics, "frameMs.p95"),
    frameP99: metric(input.metrics, "frameMs.p99"),
    vegP95: metric(input.metrics, "vegetationTotalMs.p95"),
    renderP95: metric(input.metrics, "renderMs.p95"),
    warnings: Array.isArray(input.warnings) ? input.warnings.length : null,
    errors: Array.isArray(input.errors) ? input.errors.length : null,
    failure: input.error ?? null,
    evidence,
  };
}

function compactJsonSummary(path: string): CompactSummary {
  const raw = readFileSync(path, "utf8");
  const summary = JSON.parse(raw) as P0Summary;
  const gates = summary.gates?.results ?? [];
  const cases = (summary.cases ?? []).map(compactCase);
  return {
    suite: summary.suite ?? null,
    startedAt: summary.startedAt ?? null,
    baseUrl: summary.baseUrl ?? null,
    renderer: summary.renderer ?? null,
    gateStatus: summary.gates?.status ?? null,
    failedGateCount: gates.filter((gate) => gate.status !== "passed").length,
    failedGates: gates.filter((gate) => gate.status !== "passed"),
    gates,
    failedCases: cases.filter((item) => item.status !== "passed"),
    cases,
  };
}

function compactMarkdownSummary(path: string): CompactSummary {
  const raw = readFileSync(path, "utf8");
  const gates = parseGateTable(raw);
  return {
    suite: null,
    startedAt: null,
    baseUrl: null,
    renderer: null,
    gateStatus: gates.some((gate) => gate.status !== "passed") ? "failed" : "passed",
    failedGateCount: gates.filter((gate) => gate.status !== "passed").length,
    failedGates: gates.filter((gate) => gate.status !== "passed"),
    gates,
    failedCases: [],
    cases: [],
  };
}

function parseGateTable(markdown: string): P0GateResult[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## P0 gates");
  if (start < 0) return [];
  const rows: P0GateResult[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|") || line.includes("---")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3 || cells[0] === "gate") continue;
    rows.push({ name: cells[0] ?? "", status: cells[1] ?? "", detail: cells.slice(2).join(" | ") });
  }
  return rows;
}

function readCompactSummary(path: string): CompactSummary {
  return extname(path).toLowerCase() === ".md" ? compactMarkdownSummary(path) : compactJsonSummary(path);
}

function formatMetric(value: number | null): string {
  if (value === null) return "-";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  return value.toFixed(2);
}

function compactMarkdown(summary: CompactSummary): string {
  const lines = [
    "# P0 Perf Extract",
    "",
    `Gate status: **${summary.gateStatus ?? "unknown"}** (${summary.failedGateCount} failed)`,
    summary.startedAt ? `Started: ${summary.startedAt}` : null,
    summary.baseUrl ? `Base URL: ${summary.baseUrl}` : null,
    summary.renderer ? `Renderer mode: ${summary.renderer}` : null,
    "",
    "## Failed gates",
    "",
    "| gate | detail |",
    "| --- | --- |",
  ].filter((line): line is string => line !== null);

  if (summary.failedGates.length === 0) lines.push("| - | - |");
  for (const gate of summary.failedGates) lines.push(`| ${gate.name} | ${gate.detail} |`);

  lines.push("", "## Cases", "");
  lines.push("| case | status | renderer | attempts | frame p50 | frame p95 | veg p95 | render p95 | failure |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const item of summary.cases) {
    lines.push(
      `| ${item.name} | ${item.status} | ${item.renderer} | ${item.attempts ?? "-"} | ` +
        `${formatMetric(item.frameP50)} | ${formatMetric(item.frameP95)} | ${formatMetric(item.vegP95)} | ${formatMetric(item.renderP95)} | ${item.failure ?? "-"} |`,
    );
  }

  lines.push("", "## Evidence counters", "");
  lines.push("| case | dirty status/move/reset | early before/after/rejected | source far/sampler/fallback | atlas dirty/full pixels | cache hit/miss ready/stale |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const item of summary.cases) {
    const e = item.evidence;
    lines.push(
      `| ${item.name} | ` +
        `${formatMetric(e["p0DirtyAtlasExercise.status"])}/${formatMetric(e["p0DirtyAtlasExercise.moveM"])}/${formatMetric(e["p0DirtyAtlasExercise.resetFrame"])} | ` +
        `${formatMetric(e.vegetationGpuCandidatesBudgetBeforeReject)}/${formatMetric(e.vegetationGpuCandidatesBudgetAfterReject)}/${formatMetric(e.vegetationGpuClustersRejectedEarly)} | ` +
        `${formatMetric(e.vegetationGpuSourceFarSummary)}/${formatMetric(e.vegetationGpuSourceTerrainSampler)}/${formatMetric(e.vegetationGpuSourceFallback)} | ` +
        `${formatMetric(e["naadf.farSummaryAtlas.upload.dirtyPixels"])}/${formatMetric(e["naadf.farSummaryAtlas.upload.totalPixels"])} ` +
        `(${formatMetric(e["naadf.farSummaryAtlas.upload.dirtyUploads"])}/${formatMetric(e["naadf.farSummaryAtlas.upload.fullUploads"])}) | ` +
        `${formatMetric(e.terrainMaterialCacheHits)}/${formatMetric(e.terrainMaterialCacheMisses)} ` +
        `${formatMetric(e.terrainMaterialCacheReady)}/${formatMetric(e.terrainMaterialCacheStale)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function writeOutputs(summaryPath: string, summary: CompactSummary, args: ParsedArgs): void {
  const base = args.out ?? join(dirname(summaryPath), DEFAULT_OUT_BASENAME);
  if (args.stdout) {
    console.log(args.jsonOnly ? JSON.stringify(summary, null, 2) : compactMarkdown(summary));
    return;
  }
  mkdirSync(dirname(base), { recursive: true });
  if (!args.markdownOnly) writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
  if (!args.jsonOnly) writeFileSync(`${base}.md`, compactMarkdown(summary));
  const jsonPath = args.markdownOnly ? "" : `${base}.json`;
  const markdownPath = args.jsonOnly ? "" : `${base}.md`;
  const separator = jsonPath && markdownPath ? " and " : "";
  console.log(`[perf-p0-extract] wrote ${jsonPath}${separator}${markdownPath}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const summaryPath = resolveSummaryPath(args.input);
  const summary = readCompactSummary(summaryPath);
  writeOutputs(summaryPath, summary, args);
  if (args.failOnFailure && (summary.failedGateCount > 0 || summary.failedCases.length > 0)) process.exitCode = 1;
}

main();
