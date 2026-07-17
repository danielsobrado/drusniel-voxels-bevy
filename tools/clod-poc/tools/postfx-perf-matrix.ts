import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compactStageList, postFxCaseDiagnostics, type PostFxCaseDiagnostics } from "../src/gpu/postfx_case_diagnostics.js";
import {
  evaluatePostFxPerfGate,
  parsePostFxPerfGateConfig,
} from "../src/gpu/postfx_perf_gate.js";
import { launchWebGPU } from "./launch.js";

interface PostFxPerfCase {
  name: string;
  params: Record<string, string>;
}

interface PerfProgress {
  fatal: string | null;
  ready: boolean;
  observedFrames: number;
  sampleCount: number;
  targetSampleFrames: number;
  progressMsg: string | null;
}

interface PerfCaseResult {
  name: string;
  url: string;
  diagnostics: PostFxCaseDiagnostics;
  warnings: string[];
  errors: string[];
  snapshot: any;
}

const BASELINE_CASE = "postfx-off";

const CASES: readonly PostFxPerfCase[] = [
  { name: BASELINE_CASE, params: { fx: "0" } },
  { name: "postfx-postmin", params: { postmin: "1" } },
  { name: "postfx-default", params: {} },
  { name: "postfx-no-bloom", params: { ablate: "bloom" } },
  { name: "postfx-no-taa", params: { ablate: "taa" } },
  { name: "postfx-no-aerial", params: { ablate: "aerial" } },
  { name: "postfx-no-grade", params: { ablate: "grade" } },
  { name: "postfx-contact", params: { contact: "1" } },
  { name: "postfx-gtao", params: { gtao: "1" } },
  { name: "postfx-bounce", params: { bounce: "1" } },
  { name: "postfx-froxels", params: { froxels: "1" } },
  { name: "postfx-godrays-cheap", params: { godrays: "cheap" } },
  { name: "postfx-godrays-heavy", params: { godrays: "heavy" } },
  { name: "postfx-godrays-volumetric", params: { godrays: "volumetric" } },
  { name: "postfx-all-on", params: { contact: "1", gtao: "1", bounce: "1", froxels: "1" } },
];

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i++;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function boolArg(args: Record<string, string | boolean>, key: string): boolean {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function stringArg(args: Record<string, string | boolean>, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function selectCases(rawCases: string, includeBaseline: boolean): readonly PostFxPerfCase[] {
  if (!rawCases.trim()) return CASES;
  const wanted = new Set(rawCases.split(",").map((name) => name.trim()).filter(Boolean));
  if (includeBaseline) wanted.add(BASELINE_CASE);
  const selected = CASES.filter((perfCase) => wanted.has(perfCase.name));
  const known = new Set(CASES.map((perfCase) => perfCase.name));
  const unknown = [...wanted].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown postfx perf case(s): ${unknown.join(", ")}`);
  }
  if (selected.length === 0) {
    throw new Error("No postfx perf cases selected");
  }
  return selected;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function metric(snapshot: any, name: string): { p50: number; p95: number } {
  const stats = snapshot.metrics?.[name];
  return { p50: Number(stats?.p50 ?? 0), p95: Number(stats?.p95 ?? 0) };
}

function ms(value: number): string {
  return value.toFixed(2);
}

/** Per-pass GPU ms collected by the profiler (label → avg ms), if the run resolved timestamps. */
function passMs(snapshot: any, label: string): number {
  const passes = snapshot?.counters?.gpuPassesAvg as Record<string, number> | undefined;
  return Number(passes?.[label] ?? 0);
}

/** Named postfx GPU passes surfaced as their own rows (POSTFX-801). */
const POSTFX_PASS_COLUMNS: readonly { header: string; label: string }[] = [
  { header: "scene ms", label: "r.postfxScene" },
  { header: "autoExp ms", label: "c.autoExposure" },
  { header: "froxScatter ms", label: "c.postfxFroxelScatter" },
  { header: "froxIntegrate ms", label: "c.postfxFroxelIntegrate" },
  { header: "render total ms", label: "render" },
  { header: "compute total ms", label: "compute" },
];

function perPassMarkdown(results: readonly PerfCaseResult[]): string[] {
  const header = POSTFX_PASS_COLUMNS.map((column) => column.header).join(" | ");
  const divider = POSTFX_PASS_COLUMNS.map(() => "---:").join(" | ");
  const lines = [
    "## Per-pass GPU ms (avg; 0 when the run did not resolve timestamps — e.g. software adapters)",
    "",
    `| case | ${header} |`,
    `| --- | ${divider} |`,
  ];
  for (const result of results) {
    const cells = POSTFX_PASS_COLUMNS.map((column) => ms(passMs(result.snapshot, column.label))).join(" | ");
    lines.push(`| ${result.name} | ${cells} |`);
  }
  lines.push("");
  return lines;
}

function markdown(results: readonly PerfCaseResult[]): string {
  const lines = [
    "# clod-poc WebGPU postfx perf matrix",
    "",
    "| case | expected stages | frame p50 | frame p95 | render p95 | top phase p95 | warnings | errors |",
    "| --- | --- | ---: | ---: | ---: | --- | ---: | ---: |",
  ];
  for (const result of results) {
    const frame = metric(result.snapshot, "frameMs");
    const render = metric(result.snapshot, "renderMs");
    const topPhase = result.snapshot.broadBucketsByP95?.[0];
    lines.push(
      `| ${result.name} | ${compactStageList(result.diagnostics)} | ${ms(frame.p50)} | ${ms(frame.p95)} | ${ms(render.p95)} | ` +
        `${topPhase ? `${topPhase.name} ${ms(Number(topPhase.p95 ?? 0))}` : "-"} | ` +
        `${result.warnings.length} | ${result.errors.length} |`,
    );
  }
  lines.push("");
  lines.push(...perPassMarkdown(results));
  lines.push("Run with a deterministic camera/seed and compare deltas between `postfx-off`, `postfx-postmin`, ablated cases, and opt-in heavy stages.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function runCase(
  perfCase: PostFxPerfCase,
  baseUrl: string,
  baseParams: Record<string, string>,
  outDir: string,
  timeoutMs: number,
  browser: Awaited<ReturnType<typeof launchWebGPU>>["browser"],
): Promise<PerfCaseResult> {
  const caseParams = { ...baseParams, ...perfCase.params };
  const url = buildUrl(baseUrl, caseParams);
  const diagnostics = postFxCaseDiagnostics(caseParams);
  const warnings: string[] = [];
  const errors: string[] = [];
  let lastProgress: PerfProgress | null = null;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("console", (msg) => {
    if (msg.type() === "warning") warnings.push(msg.text());
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    console.log(`[postfx-perf] ${perfCase.name}: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 60000) });
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      lastProgress = await page.evaluate<PerfProgress>(() => {
        const perf = window.__drusnielPerf;
        const clod = window.__drusnielClod;
        return {
          fatal: clod?.error ?? null,
          ready: perf?.ready ?? false,
          observedFrames: perf?.observedFrames ?? 0,
          sampleCount: perf?.sampleCount ?? 0,
          targetSampleFrames: perf?.targetSampleFrames ?? 0,
          progressMsg: clod?.progressMsg ?? null,
        };
      });
      if (lastProgress.fatal) throw new Error(lastProgress.fatal);
      if (lastProgress.ready) break;
      await delay(250);
    }
    const snapshot = await page.evaluate(() => window.__drusnielPerf?.snapshot() ?? null);
    if (!snapshot?.ready) {
      throw new Error(`Perf probe did not finish: ${JSON.stringify(lastProgress)}`);
    }
    const result = { name: perfCase.name, url, diagnostics, warnings, errors, snapshot };
    writeFileSync(join(outDir, `${perfCase.name}.json`), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await page.close().catch(() => undefined);
  }
}

function enforcePerfThresholds(summary: { cases: PerfCaseResult[] }, configPath: string): void {
  const config = parsePostFxPerfGateConfig(readFileSync(configPath, "utf8"));
  const result = evaluatePostFxPerfGate(summary, config);
  if (!result.enabled) return;
  for (const row of result.rows) {
    console.log(
      `[postfx-perf] ${row.caseName}: ` +
        `frameP50 +${ms(row.frameP50DeltaMs)}/${row.thresholds.maxFrameP50DeltaMs}, ` +
        `frameP95 +${ms(row.frameP95DeltaMs)}/${row.thresholds.maxFrameP95DeltaMs}, ` +
        `renderP95 +${ms(row.renderP95DeltaMs)}/${row.thresholds.maxRenderP95DeltaMs}`,
    );
  }
  if (result.failures.length === 0) return;
  for (const item of result.failures) {
    console.error(`[postfx-perf] LIMIT ${item.caseName} ${item.metric}: +${ms(item.deltaMs)} > ${item.thresholdMs}`);
  }
  throw new Error(`${result.failures.length} postfx perf threshold(s) exceeded`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = stringArg(args, "baseUrl", process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5180/");
  const warmupFrames = stringArg(args, "warmup", "120");
  const sampleFrames = stringArg(args, "frames", "300");
  const timeoutMs = Number(stringArg(args, "timeout", "180000"));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = stringArg(args, "out", join("perf-runs", `postfx-${runId}`));
  const shouldCheck = boolArg(args, "check");
  const selectedCases = selectCases(stringArg(args, "case", ""), shouldCheck);
  const gateConfig = stringArg(args, "gateConfig", "src/environment/config/postfx_perf_gate.yaml");
  mkdirSync(outDir, { recursive: true });

  const baseParams = {
    world: stringArg(args, "world", "8"),
    seed: "1",
    webgpuSelection: "1",
    farShell: "1",
    freeze: stringArg(args, "freeze", "1"),
    perfProbe: "1",
    perfWarmup: warmupFrames,
    perfFrames: sampleFrames,
    profile: "0",
  };

  const { browser, recipe } = await launchWebGPU();
  const results: PerfCaseResult[] = [];
  try {
    for (const perfCase of selectedCases) {
      results.push(await runCase(perfCase, baseUrl, baseParams, outDir, timeoutMs, browser));
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const summary = { schemaVersion: 1, baseUrl, baseParams, selectedCases: selectedCases.map((entry) => entry.name), launchRecipe: recipe, cases: results };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(outDir, "summary.md"), markdown(results));
  if (shouldCheck) enforcePerfThresholds(summary, gateConfig);
  console.log(`[postfx-perf] wrote ${join(outDir, "summary.md")}`);
}

main().catch((error: unknown) => {
  console.error("[postfx-perf] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
