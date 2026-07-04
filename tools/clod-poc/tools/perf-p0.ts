import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { clodBaseUrl, launchChromium, launchWebGPU } from "./launch.js";
import { evaluateP0PerfGates, type P0PerfGateSummary } from "./perf-p0-gates.js";
import type { FramePerfMetric, FramePerfSnapshot } from "../src/app/frame_loop/perf_probe.js";

type Args = Record<string, string | boolean>;
type RendererKind = "webgpu" | "webgl";
type RendererMode = RendererKind | "auto";
type CaseStatus = "passed" | "failed";

interface PerfCase {
  name: string;
  params: Record<string, string>;
}

interface PerfCaseProgress {
  fatal: string | null;
  ready: boolean;
  observedFrames: number;
  sampleCount: number;
  targetSampleFrames: number;
  progressMsg: string | null;
  clodReady: boolean | null;
  lastFrameId: number | null;
}

interface BrowserState {
  snapshot: FramePerfSnapshot | null;
  finalCounters: Record<string, number>;
}

interface GitState {
  head: string | null;
  status: string | null;
}

interface PerfCaseAttempt {
  renderer: RendererKind;
  url: string;
  status: CaseStatus;
  warnings: string[];
  errors: string[];
  launchRecipe: unknown;
  lastProgress: PerfCaseProgress | null;
  snapshot: FramePerfSnapshot | null;
  finalCounters: Record<string, number>;
  gitStateStart: GitState;
  gitStateEnd: GitState;
  pageNavigationCount: number;
  contaminated: boolean;
  error: string | null;
}

interface PerfCaseResult extends PerfCaseAttempt {
  name: string;
  attempts: PerfCaseAttempt[];
  metrics: Record<string, number | null>;
}

const P0_CASES: PerfCase[] = [
  { name: "terrain-material-cache-disabled", params: { scene: "infinite-naadf-far", terrainMaterialCache: "0" } },
  { name: "terrain-material-cache-enabled", params: { scene: "infinite-naadf-far", terrainMaterialCache: "1" } },
  { name: "gpu-early-reject-disabled", params: { scene: "infinite-naadf-forest", gpuEarlyReject: "0", treeGpu: "1", grass: "1", understory: "1" } },
  { name: "gpu-early-reject-enabled", params: { scene: "infinite-naadf-forest", gpuEarlyReject: "1", treeGpu: "1", grass: "1", understory: "1" } },
  { name: "gpu-early-reject-enabled-with-debug-oracle", params: { scene: "infinite-naadf-forest", gpuEarlyReject: "1", gpuEarlyRejectDebugOracle: "1", treeGpu: "1", grass: "1", understory: "1" } },
  { name: "combined-cache-and-early-reject-enabled", params: { scene: "infinite-naadf-forest", terrainMaterialCache: "1", gpuEarlyReject: "1", treeGpu: "1", grass: "1", understory: "1" } },
];

const PHASE_METRICS = [
  "frameMs",
  "selectionUpdateMs",
  "farSummaryMs",
  "vegetationTotalMs",
  "statsSyncMs",
  "renderMs",
] as const satisfies readonly FramePerfMetric[];

const P0_COUNTERS = [
  "terrainMaterialCacheHits",
  "terrainMaterialCacheMisses",
  "terrainMaterialCacheQueued",
  "terrainMaterialCacheReady",
  "terrainMaterialCacheStale",
  "terrainMaterialCacheEvictions",
  "terrainMaterialBakeMs",
  "terrainMaterialUploadMs",
  "vegetationGpuClustersTotal",
  "vegetationGpuClustersRejectedEarly",
  "vegetationGpuClustersAccepted",
  "vegetationGpuClustersSummaryMissing",
  "vegetationGpuFarSummaryConsulted",
  "vegetationGpuSourceFarSummary",
  "vegetationGpuSourceTerrainSampler",
  "vegetationGpuSourceFallback",
  "vegetationGpuCandidatesBudgetBeforeReject",
  "vegetationGpuCandidatesBudgetAfterReject",
  "vegetationGpuCandidatesGenerated",
  "treeGpuCandidateCountBeforePrefilterAvg",
  "treeGpuCandidateCountAfterPrefilterAvg",
  "treeGpuPrefilterFarSummaryConsultedAvg",
  "treeGpuPrefilterSourceFarSummaryAvg",
  "treeGpuPrefilterSourceTerrainSamplerAvg",
  "treeGpuPrefilterSourceFallbackAvg",
  "grassGpuCandidateCountBeforePrefilterAvg",
  "grassGpuCandidateCountAfterPrefilterAvg",
  "grassGpuPrefilterFarSummaryConsultedAvg",
  "grassGpuPrefilterSourceFarSummaryAvg",
  "grassGpuPrefilterSourceTerrainSamplerAvg",
  "grassGpuPrefilterSourceFallbackAvg",
  "understoryGpuCandidateCountBeforePrefilterAvg",
  "understoryGpuCandidateCountAfterPrefilterAvg",
  "understoryGpuPrefilterFarSummaryConsultedAvg",
  "understoryGpuPrefilterSourceFarSummaryAvg",
  "understoryGpuPrefilterSourceTerrainSamplerAvg",
  "understoryGpuPrefilterSourceFallbackAvg",
  "pageGeometryCache.hits",
  "pageGeometryCache.misses",
  "pageGeometryCache.entries",
  "pageGeometryCache.estimatedBytes",
  "renderNodeCache.creates",
  "renderNodeCache.reuses",
  "renderNodeCache.evictions",
  "renderNodeCache.materializedNodes",
  "materialChurn.suspectedPipelineKeyChanges",
  "materialChurn.materialAssignments",
  "materialChurn.newMaterials",
  "naadf.farSummaryAtlas.estimatedBytes",
  "naadf.farSummaryAtlas.memorySavingsBytes",
  "naadf.farSummaryAtlas.memorySavingsPct",
  "naadf.farSummaryAtlas.upload.totalPixels",
  "naadf.farSummaryAtlas.upload.dirtyPixels",
  "naadf.farSummaryAtlas.upload.dirtyPct",
  "naadf.farSummaryAtlas.upload.dirtyRects",
  "naadf.farSummaryAtlas.upload.dirtyUploads",
  "naadf.farSummaryAtlas.upload.fullUploads",
  "naadf.farSummaryAtlas.upload.modeCode",
  "naadf.farSummaryAtlas.upload.fallbackReasonCode",
  "p0DirtyAtlasExercise.enabled",
  "p0DirtyAtlasExercise.status",
  "p0DirtyAtlasExercise.requestedTiles",
  "p0DirtyAtlasExercise.bumpedTiles",
  "p0DirtyAtlasExercise.triggeredFrame",
  "p0DirtyAtlasExercise.resetFrame",
  "p0DirtyAtlasExercise.settleRemaining",
] as const;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function flag(value: string | boolean | undefined): boolean {
  return value === true || value === "1" || value === "true";
}

function parseParams(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) throw new Error(`Invalid --params entry: ${trimmed}`);
    out[trimmed.slice(0, equals)] = trimmed.slice(equals + 1);
  }
  return out;
}

function selectCases(rawCase: string | undefined): PerfCase[] {
  if (!rawCase) return P0_CASES;
  const wanted = new Set(rawCase.split(",").map((name) => name.trim()).filter(Boolean));
  const selected = P0_CASES.filter((perfCase) => wanted.has(perfCase.name));
  const missing = [...wanted].filter((name) => !P0_CASES.some((perfCase) => perfCase.name === name));
  if (missing.length > 0) throw new Error(`Unknown P0 perf case(s): ${missing.join(", ")}`);
  if (selected.length === 0) throw new Error("No P0 perf cases selected");
  return selected;
}

function buildUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "-");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gitState(): GitState {
  try {
    return {
      head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      status: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
    };
  } catch {
    return { head: null, status: null };
  }
}

function gitStateChanged(start: GitState, end: GitState): boolean {
  return start.head !== end.head || start.status !== end.status;
}

async function captureBrowserState(page: Page | null): Promise<BrowserState> {
  if (!page || page.isClosed()) return { snapshot: null, finalCounters: {} };
  return page.evaluate<BrowserState>(() => ({
    snapshot: window.__drusnielPerf?.snapshot() ?? null,
    finalCounters: { ...(window.__drusnielClod?.stats?.counters ?? {}) },
  })).catch(() => ({ snapshot: null, finalCounters: {} }));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function metricPercentile(snapshot: FramePerfSnapshot | null, metric: FramePerfMetric, p: number): number | null {
  if (!snapshot) return null;
  if (p === 50) return snapshot.metrics[metric]?.p50 ?? null;
  if (p === 95) return snapshot.metrics[metric]?.p95 ?? null;
  return percentile(snapshot.samples.map((sample) => sample[metric]), p);
}

function snapshotCounter(snapshot: FramePerfSnapshot | null, name: string): number | null {
  if (!snapshot) return null;
  const counters = snapshot.counters as unknown as Record<string, unknown>;
  return numberOrNull(counters[name]);
}

function counterValue(
  snapshot: FramePerfSnapshot | null,
  finalCounters: Record<string, number>,
  name: string,
): number | null {
  if (Object.prototype.hasOwnProperty.call(finalCounters, name)) return numberOrNull(finalCounters[name]);
  if (!name.includes(".")) return snapshotCounter(snapshot, `${name}Avg`) ?? snapshotCounter(snapshot, name);
  return null;
}

function collectMetrics(snapshot: FramePerfSnapshot | null, finalCounters: Record<string, number>): Record<string, number | null> {
  const metrics: Record<string, number | null> = {};
  for (const metric of PHASE_METRICS) {
    metrics[`${metric}.p50`] = metricPercentile(snapshot, metric, 50);
    metrics[`${metric}.p95`] = metricPercentile(snapshot, metric, 95);
    metrics[`${metric}.p99`] = metricPercentile(snapshot, metric, 99);
  }
  for (const counter of P0_COUNTERS) metrics[counter] = counterValue(snapshot, finalCounters, counter);
  return metrics;
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  return value.toFixed(2);
}

function writeJson(outDir: string, name: string, value: unknown): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${safeFileName(name)}.json`), JSON.stringify(value, null, 2));
}

async function launch(renderer: RendererKind): Promise<{ browser: Browser; recipe: unknown }> {
  return renderer === "webgpu" ? launchWebGPU() : launchChromium();
}

function rendererParams(baseParams: Record<string, string>, renderer: RendererKind): Record<string, string> {
  if (renderer === "webgpu") return baseParams;
  return { ...baseParams, webgpuSelection: "0" };
}

async function runAttempt(
  perfCase: PerfCase,
  renderer: RendererKind,
  baseParams: Record<string, string>,
  baseUrl: string,
  timeoutMs: number,
  outDir: string,
): Promise<PerfCaseAttempt> {
  const warnings: string[] = [];
  const errors: string[] = [];
  let browser: Browser | null = null;
  let page: Page | null = null;
  let launchRecipe: unknown = null;
  let lastProgress: PerfCaseProgress | null = null;
  let pageNavigationCount = 0;
  const params = { ...rendererParams(baseParams, renderer), ...perfCase.params };
  const url = buildUrl(baseUrl, params);
  const gitStateStart = gitState();

  try {
    const launched = await launch(renderer);
    browser = launched.browser;
    launchRecipe = launched.recipe;
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(Math.min(timeoutMs, 60000));
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "warning") warnings.push(text);
      if (msg.type() === "error") errors.push(text);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("framenavigated", (frame) => {
      if (frame === page?.mainFrame()) pageNavigationCount++;
    });

    try {
      console.log(`[perf-p0] ${perfCase.name} ${renderer}: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 60000) });
      const start = Date.now();
      let lastLogAt = 0;
      while (Date.now() - start < timeoutMs) {
        lastProgress = await page.evaluate<PerfCaseProgress>(() => {
          const perf = window.__drusnielPerf;
          const clod = window.__drusnielClod;
          return {
            fatal: clod?.error ?? null,
            ready: perf?.ready ?? false,
            observedFrames: perf?.observedFrames ?? 0,
            sampleCount: perf?.sampleCount ?? 0,
            targetSampleFrames: perf?.targetSampleFrames ?? 0,
            progressMsg: clod?.progressMsg ?? null,
            clodReady: clod?.ready ?? null,
            lastFrameId: perf?.lastSample?.frameId ?? null,
          };
        }).catch((error: unknown) => {
          errors.push(error instanceof Error ? error.message : String(error));
          return lastProgress;
        });
        if (lastProgress?.fatal) throw new Error(`App fatal error: ${lastProgress.fatal}`);
        if (lastProgress?.ready) break;
        if (Date.now() - lastLogAt >= 5000) {
          lastLogAt = Date.now();
          const progress = lastProgress
            ? `${lastProgress.sampleCount}/${lastProgress.targetSampleFrames} samples, ${lastProgress.observedFrames} observed, ${lastProgress.progressMsg ?? "no clod hooks"}`
            : "no progress";
          console.log(`[perf-p0] ${perfCase.name} ${renderer}: waiting (${progress})`);
        }
        await delay(250);
      }

      const state = await captureBrowserState(page);
      if (!state.snapshot) throw new Error("Missing window.__drusnielPerf snapshot");
      const gitStateEnd = gitState();
      const contaminated = gitStateChanged(gitStateStart, gitStateEnd) || pageNavigationCount > 1;
      if (!state.snapshot.ready) {
        const result: PerfCaseAttempt = {
          renderer,
          url,
          status: "failed",
          warnings,
          errors,
          launchRecipe,
          lastProgress,
          snapshot: state.snapshot,
          finalCounters: state.finalCounters,
          gitStateStart,
          gitStateEnd,
          pageNavigationCount,
          contaminated,
          error:
            `Perf probe timed out after ${timeoutMs}ms: ` +
            `${state.snapshot.sampleCount}/${state.snapshot.targetSampleFrames} samples, ${state.snapshot.observedFrames} observed frames`,
        };
        writeJson(outDir, `${perfCase.name}-${renderer}-FAILED`, result);
        return result;
      }
      const result: PerfCaseAttempt = {
        renderer,
        url,
        status: "passed",
        warnings,
        errors,
        launchRecipe,
        lastProgress,
        snapshot: state.snapshot,
        finalCounters: state.finalCounters,
        gitStateStart,
        gitStateEnd,
        pageNavigationCount,
        contaminated,
        error: null,
      };
      writeJson(outDir, `${perfCase.name}-${renderer}`, result);
      return result;
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (error) {
    const state = await captureBrowserState(page);
    const gitStateEnd = gitState();
    const contaminated = gitStateChanged(gitStateStart, gitStateEnd) || pageNavigationCount > 1;
    const result: PerfCaseAttempt = {
      renderer,
      url,
      status: "failed",
      warnings,
      errors,
      launchRecipe,
      lastProgress,
      snapshot: state.snapshot,
      finalCounters: state.finalCounters,
      gitStateStart,
      gitStateEnd,
      pageNavigationCount,
      contaminated,
      error: error instanceof Error ? error.message : String(error),
    };
    writeJson(outDir, `${perfCase.name}-${renderer}-FAILED`, result);
    return result;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function shouldRetryWebgl(attempt: PerfCaseAttempt): boolean {
  const text = [attempt.error, ...attempt.errors, ...attempt.warnings].filter(Boolean).join("\n").toLowerCase();
  return attempt.status === "failed" && (
    text.includes("webgpu") ||
    text.includes("device lost") ||
    text.includes("gpu device") ||
    text.includes("adapter") ||
    text.includes("destroyed")
  );
}

async function runCase(
  perfCase: PerfCase,
  rendererMode: RendererMode,
  baseParams: Record<string, string>,
  baseUrl: string,
  timeoutMs: number,
  outDir: string,
): Promise<PerfCaseResult> {
  const attempts: PerfCaseAttempt[] = [];
  const firstRenderer: RendererKind = rendererMode === "webgl" ? "webgl" : "webgpu";
  const first = await runAttempt(perfCase, firstRenderer, baseParams, baseUrl, timeoutMs, outDir);
  attempts.push(first);

  let selected = first;
  if (rendererMode === "auto" && shouldRetryWebgl(first)) {
    console.warn(`[perf-p0] ${perfCase.name}: WebGPU attempt failed; retrying with WebGL/Chromium fallback`);
    const fallback = await runAttempt(perfCase, "webgl", baseParams, baseUrl, timeoutMs, outDir);
    attempts.push(fallback);
    selected = fallback.status === "passed" ? fallback : first;
  }

  return {
    ...selected,
    name: perfCase.name,
    attempts,
    metrics: collectMetrics(selected.snapshot, selected.finalCounters),
  };
}

function markdown(results: readonly PerfCaseResult[], gates: P0PerfGateSummary): string {
  const lines = [
    "# CLOD-POC P0 Performance Validation",
    "",
    "This report is generated by `npm run perf:p0`. Failed cases are kept in the report instead of aborting the run.",
    "",
    "## Status",
    "",
    "| case | status | contaminated | navs | renderer | attempts | frame p50 | frame p95 | frame p99 | veg p95 | render p95 | warnings | errors | failure |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const result of results) {
    lines.push(
      `| ${result.name} | ${result.status} | ${result.contaminated ? "yes" : "no"} | ${result.pageNavigationCount} | ${result.renderer} | ${result.attempts.length} | ` +
        `${fmt(result.metrics["frameMs.p50"])} | ${fmt(result.metrics["frameMs.p95"])} | ${fmt(result.metrics["frameMs.p99"])} | ` +
        `${fmt(result.metrics["vegetationTotalMs.p95"])} | ${fmt(result.metrics["renderMs.p95"])} | ` +
        `${result.warnings.length} | ${result.errors.length} | ${result.error ?? "-"} |`,
    );
  }

  lines.push("", "## P0 gates", "");
  lines.push(`Overall gate status: **${gates.status}** (${gates.failedCount} failed)`);
  lines.push("", "| gate | status | detail |", "| --- | --- | --- |");
  for (const gate of gates.results) {
    lines.push(`| ${gate.name} | ${gate.status} | ${gate.detail} |`);
  }

  lines.push("", "## Required P0 counters", "");
  lines.push("| case | cache hit/miss | cache ready/stale | dirty exercise status/bumped/reset | veg clusters rejected/accepted/missing | veg consulted | veg src far/sampler/fallback | tree consulted/src far/sampler/fallback | grass consulted/src far/sampler/fallback | under consulted/src far/sampler/fallback | candidate budget before/after/generated | grass before/after | understory before/after | page geom hit/miss | render node create/reuse | churn key/assign/new |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const result of results) {
    const m = result.metrics;
    lines.push(
      `| ${result.name} | ` +
        `${fmt(m.terrainMaterialCacheHits)}/${fmt(m.terrainMaterialCacheMisses)} | ` +
        `${fmt(m.terrainMaterialCacheReady)}/${fmt(m.terrainMaterialCacheStale)} | ` +
        `${fmt(m["p0DirtyAtlasExercise.status"])}/${fmt(m["p0DirtyAtlasExercise.bumpedTiles"])}/${fmt(m["p0DirtyAtlasExercise.resetFrame"])} | ` +
        `${fmt(m.vegetationGpuClustersRejectedEarly)}/${fmt(m.vegetationGpuClustersAccepted)}/${fmt(m.vegetationGpuClustersSummaryMissing)} | ` +
        `${fmt(m.vegetationGpuFarSummaryConsulted)} | ` +
        `${fmt(m.vegetationGpuSourceFarSummary)}/${fmt(m.vegetationGpuSourceTerrainSampler)}/${fmt(m.vegetationGpuSourceFallback)} | ` +
        `${fmt(m.treeGpuPrefilterFarSummaryConsultedAvg)}/${fmt(m.treeGpuPrefilterSourceFarSummaryAvg)}/${fmt(m.treeGpuPrefilterSourceTerrainSamplerAvg)}/${fmt(m.treeGpuPrefilterSourceFallbackAvg)} | ` +
        `${fmt(m.grassGpuPrefilterFarSummaryConsultedAvg)}/${fmt(m.grassGpuPrefilterSourceFarSummaryAvg)}/${fmt(m.grassGpuPrefilterSourceTerrainSamplerAvg)}/${fmt(m.grassGpuPrefilterSourceFallbackAvg)} | ` +
        `${fmt(m.understoryGpuPrefilterFarSummaryConsultedAvg)}/${fmt(m.understoryGpuPrefilterSourceFarSummaryAvg)}/${fmt(m.understoryGpuPrefilterSourceTerrainSamplerAvg)}/${fmt(m.understoryGpuPrefilterSourceFallbackAvg)} | ` +
        `${fmt(m.vegetationGpuCandidatesBudgetBeforeReject)}/${fmt(m.vegetationGpuCandidatesBudgetAfterReject)}/${fmt(m.vegetationGpuCandidatesGenerated)} | ` +
        `${fmt(m.grassGpuCandidateCountBeforePrefilterAvg)}/${fmt(m.grassGpuCandidateCountAfterPrefilterAvg)} | ` +
        `${fmt(m.understoryGpuCandidateCountBeforePrefilterAvg)}/${fmt(m.understoryGpuCandidateCountAfterPrefilterAvg)} | ` +
        `${fmt(m["pageGeometryCache.hits"])}/${fmt(m["pageGeometryCache.misses"])} | ` +
        `${fmt(m["renderNodeCache.creates"])}/${fmt(m["renderNodeCache.reuses"])} | ` +
        `${fmt(m["materialChurn.suspectedPipelineKeyChanges"])}/${fmt(m["materialChurn.materialAssignments"])}/${fmt(m["materialChurn.newMaterials"])} |`,
    );
  }

  lines.push("", "## Far-summary atlas upload and packing", "");
  lines.push("| case | estimated bytes | savings bytes/pct | upload mode | fallback reason | dirty/full uploads | dirty pixels/total | dirty rects | dirty pct |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const result of results) {
    const m = result.metrics;
    lines.push(
      `| ${result.name} | ` +
        `${fmt(m["naadf.farSummaryAtlas.estimatedBytes"])} | ` +
        `${fmt(m["naadf.farSummaryAtlas.memorySavingsBytes"])}/${fmt(m["naadf.farSummaryAtlas.memorySavingsPct"])} | ` +
        `${fmt(m["naadf.farSummaryAtlas.upload.modeCode"])} | ` +
        `${fmt(m["naadf.farSummaryAtlas.upload.fallbackReasonCode"])} | ` +
        `${fmt(m["naadf.farSummaryAtlas.upload.dirtyUploads"])}/${fmt(m["naadf.farSummaryAtlas.upload.fullUploads"])} | ` +
        `${fmt(m["naadf.farSummaryAtlas.upload.dirtyPixels"])}/${fmt(m["naadf.farSummaryAtlas.upload.totalPixels"])} | ` +
        `${fmt(m["naadf.farSummaryAtlas.upload.dirtyRects"])} | ` +
        `${fmt(m["naadf.farSummaryAtlas.upload.dirtyPct"])} |`,
    );
  }

  lines.push(
    "",
    "## Interpretation notes",
    "",
    "- `-` means the metric was not exposed by the current runtime path. Do not treat missing metrics as zero.",
    "- `contaminated=yes` means the git working tree changed or the page navigated again during the case; treat those numbers as suspect.",
    "- A WebGPU failure may be retried with WebGL only to keep the report complete; the selected renderer column shows which attempt produced the reported numbers.",
    "- P0 gates are evidence gates, not FPS gates. Use `--failOnGateFailure` to make the runner exit non-zero when evidence is missing.",
    "- Dirty exercise status codes are 0=disabled, 1=pending, 2=settling, 3=done, 4=skipped. The P0 runner enables it by default for NAADF scenes.",
    "- Vegetation source counts show which classifier source produced cluster prefilter decisions for trees, grass, and understory: far-summary, terrain sampler, or conservative fallback.",
    "- Atlas upload mode is numeric: 0=none, 1=dirty, 2=full. Fallback reason is numeric: 0=none, 1=initial, 2=explicit, 3=disabled, 4=too_many_rects, 5=threshold, 6=invalid_atlas, 7=partial_ranges_unsupported, 8=full_invalidation.",
    "- This runner records evidence. It does not prove visual parity by itself.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const baseUrl = str(args.baseUrl) ?? process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
  process.env.CLOD_POC_BASE_URL = baseUrl;

  const renderer = (str(args.renderer) ?? "auto") as RendererMode;
  if (!["auto", "webgpu", "webgl"].includes(renderer)) throw new Error(`Invalid --renderer ${renderer}`);

  const baseParams: Record<string, string> = {
    world: str(args.world) ?? "8",
    seed: str(args.seed) ?? "1",
    webgpuSelection: "1",
    farShell: "1",
    freeze: str(args.freeze) ?? "1",
    perfProbe: "1",
    perfWarmup: str(args.warmup) ?? "120",
    perfFrames: str(args.frames) ?? "300",
    p0DirtyAtlasExercise: str(args.dirtyAtlasExercise) ?? "1",
    dirtyAtlasTiles: str(args.dirtyAtlasTiles) ?? "4",
    dirtyAtlasSettleFrames: str(args.dirtyAtlasSettleFrames) ?? "18",
    profile: "0",
    ...parseParams(str(args.params)),
  };

  const timeoutMs = Number(str(args.timeout) ?? 180000);
  const outDir = str(args.out) ?? join("perf-runs", `p0-${runId}`);
  const cases = selectCases(str(args.case));
  mkdirSync(outDir, { recursive: true });

  const results: PerfCaseResult[] = [];
  for (const perfCase of cases) {
    results.push(await runCase(perfCase, renderer, baseParams, baseUrl, timeoutMs, outDir));
  }
  const gates = evaluateP0PerfGates(results);

  const summary = {
    schemaVersion: 1,
    suite: "p0-performance-validation",
    startedAt: startedAt.toISOString(),
    baseUrl,
    renderer,
    baseParams,
    gates,
    cases: results,
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(outDir, "summary.md"), markdown(results, gates));
  console.log(`[perf-p0] wrote ${join(outDir, "summary.json")}`);
  console.log(`[perf-p0] wrote ${join(outDir, "summary.md")}`);

  if (flag(args.failOnCaseFailure) && results.some((result) => result.status === "failed")) {
    process.exitCode = 1;
  }
  if (flag(args.failOnGateFailure) && gates.status === "failed") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("[perf-p0] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
