import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";
import { launchChromium, launchWebGPU } from "./launch.js";
import type { FramePerfMetric, FramePerfSnapshot } from "../src/app/frame_loop/perf_probe.js";

type Args = Record<string, string | boolean>;

interface PerfCase {
  name: string;
  params: Record<string, string>;
}

interface PerfCaseResult {
  name: string;
  url: string;
  warnings: string[];
  errors: string[];
  snapshot: FramePerfSnapshot;
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

const CASES: PerfCase[] = [
  { name: "current-textured", params: {} },
  { name: "debug-flat", params: { terrainMaterial: "debug_flat", terrainTriplanar: "0" } },
  { name: "triplanar-off", params: { terrainTriplanar: "0" } },
  { name: "tree-gpu-ring", params: { treeGpu: "1" } },
  { name: "tree-gpu-visible-12k", params: { treeGpu: "1", treeGpuMaxVisible: "12000" } },
  { name: "tree-gpu-visible-9k", params: { treeGpu: "1", treeGpuMaxVisible: "9000" } },
  { name: "tree-distance-360", params: { treeGpu: "1", treeDistance: "360" } },
  { name: "trees-off", params: { trees: "0", understory: "0" } },
  { name: "grass-off", params: { grass: "0" } },
  { name: "stones-off", params: { stones: "0" } },
  { name: "vegetation-off", params: { grass: "0", trees: "0", stones: "0", understory: "0", weather: "off" } },
  { name: "water-weather-off", params: { water: "0", weather: "off" } },
  { name: "far-shell-off", params: { farShell: "0" } },
  { name: "selection-cpu", params: { webgpuSelection: "0" } },
  { name: "clod-perf-mode", params: { clodPerf: "1" } },
];

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

function buildUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function selectCases(rawCase: string | undefined): PerfCase[] {
  if (!rawCase) return CASES;
  const wanted = new Set(rawCase.split(",").map((name) => name.trim()).filter(Boolean));
  const selected = CASES.filter((perfCase) => wanted.has(perfCase.name));
  const missing = [...wanted].filter((name) => !CASES.some((perfCase) => perfCase.name === name));
  if (missing.length > 0) throw new Error(`Unknown perf case(s): ${missing.join(", ")}`);
  if (selected.length === 0) throw new Error("No perf cases selected");
  return selected;
}

function metric(snapshot: FramePerfSnapshot, name: FramePerfMetric): { avg: number; p50: number; p95: number } {
  const stats = snapshot.metrics[name];
  return { avg: stats.avg, p50: stats.p50, p95: stats.p95 };
}

function ms(value: number): string {
  return value.toFixed(2);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeCaseArtifact(outDir: string, name: string, value: unknown): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(value, null, 2));
}

function markdown(results: readonly PerfCaseResult[]): string {
  const lines = [
    "# clod-poc main perf",
    "",
    "| case | frame p50 | frame p95 | gpu render p50 | gpu render p95 | gpu compute p50 | top phase p95 | top prop p95 | render p95 | tree GPU | tree visible avg | tree lod avg | prop GPU | prop visible avg | tris avg |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | ---: | --- | --- | ---: | ---: |",
  ];
  // [DEBUG-bs9f] percentile over sample-level GPU timings (0 values dropped: pre-resolve / unsupported).
  const gpuPctl = (samples: readonly { gpuRenderMs?: number; gpuComputeMs?: number }[], key: "gpuRenderMs" | "gpuComputeMs", ratio: number): number => {
    const values = samples.map((s) => s[key] ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))] ?? 0;
  };
  for (const result of results) {
    const snapshot = result.snapshot;
    const frame = metric(snapshot, "frameMs");
    const render = metric(snapshot, "renderMs");
    const gpuRenderP50 = gpuPctl(snapshot.samples, "gpuRenderMs", 0.5); // [DEBUG-bs9f]
    const gpuRenderP95 = gpuPctl(snapshot.samples, "gpuRenderMs", 0.95); // [DEBUG-bs9f]
    const gpuComputeP50 = gpuPctl(snapshot.samples, "gpuComputeMs", 0.5); // [DEBUG-bs9f]
    const topPhase = snapshot.broadBucketsByP95[0];
    const topProp = snapshot.propBucketsByP95[0];
    const statusCounts = Object.entries(snapshot.counters.treeGpuStatusCounts)
      .map(([status, count]) => `${status}:${count}`)
      .join(" ");
    const propStatusCounts = Object.entries(snapshot.counters.customPropGpuStatusCounts)
      .map(([status, count]) => `${status}:${count}`)
      .join(" ");
    const treeLod =
      `${Math.round(snapshot.counters.treeNearTreesAvg)}/` +
      `${Math.round(snapshot.counters.treeMidTreesAvg)}/` +
      `${Math.round(snapshot.counters.treeFarTreesAvg)}/` +
      `${Math.round(snapshot.counters.treeImpostorTreesAvg)}`;
    lines.push(
      `| ${result.name} | ${ms(frame.p50)} | ${ms(frame.p95)} | ` +
        `${ms(gpuRenderP50)} | ${ms(gpuRenderP95)} | ${ms(gpuComputeP50)} | ` +
        `${topPhase ? `${topPhase.name} ${ms(topPhase.p95)}` : "-"} | ` +
        `${topProp ? `${topProp.name} ${ms(topProp.p95)}` : "-"} | ` +
        `${ms(render.p95)} | ${statusCounts || "-"} | ` +
        `${Math.round(snapshot.counters.treeGpuVisibleCountAvg).toLocaleString("en-US")} | ` +
        `${treeLod} | ` +
        `${propStatusCounts || "-"} | ` +
        `${Math.round(snapshot.counters.customPropGpuVisibleCountAvg).toLocaleString("en-US")} | ` +
        `${Math.round(snapshot.counters.terrainTrianglesAvg).toLocaleString("en-US")} |`,
    );
  }
  lines.push("");
  lines.push("Broad phase buckets are measured around the frame-loop calls. `props unattributed` is time between terrain and render that was not assigned to shadow, canopy, vegetation, border debug, or stats sync.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function runCase(
  perfCase: PerfCase,
  baseParams: Record<string, string>,
  baseUrl: string,
  timeoutMs: number,
  browser: Browser,
  outDir: string,
): Promise<PerfCaseResult> {
  const params = { ...baseParams, ...perfCase.params };
  const url = buildUrl(baseUrl, params);
  const warnings: string[] = [];
  const errors: string[] = [];
  let lastProgress: PerfCaseProgress | null = null;
  let lastProgressLogAt = 0;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(Math.min(timeoutMs, 60000));
  page.on("console", (msg: { text(): string; type(): string }) => {
    const text = msg.text();
    if (msg.type() === "warning") warnings.push(text);
    if (msg.type() === "error") errors.push(text);
  });
  page.on("pageerror", (error: Error) => errors.push(error.message));
  try {
    console.log(`[perf-main] ${perfCase.name}: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 60000) });
    const start = Date.now();
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
      if (Date.now() - lastProgressLogAt >= 5000) {
        lastProgressLogAt = Date.now();
        const progress = lastProgress
          ? `${lastProgress.sampleCount}/${lastProgress.targetSampleFrames} samples, ${lastProgress.observedFrames} observed, ${lastProgress.progressMsg ?? "no clod hooks"}`
          : "no progress";
        console.log(`[perf-main] ${perfCase.name}: waiting (${progress})`);
      }
      await delay(250);
    }
    const snapshot = await page.evaluate(() => window.__drusnielPerf?.snapshot() ?? null);
    if (!snapshot) throw new Error("Missing window.__drusnielPerf snapshot");
    if (!snapshot.ready) {
      throw new Error(
        `Perf probe timed out after ${timeoutMs}ms: ` +
          `${snapshot.sampleCount}/${snapshot.targetSampleFrames} samples, ${snapshot.observedFrames} observed frames`,
      );
    }
    const result = { name: perfCase.name, url, warnings, errors, snapshot };
    writeCaseArtifact(outDir, perfCase.name, result);
    return result;
  } catch (error) {
    const failure = {
      name: perfCase.name,
      url,
      warnings,
      errors,
      lastProgress,
      error: error instanceof Error ? error.message : String(error),
    };
    writeCaseArtifact(outDir, `${perfCase.name}-FAILED`, failure);
    throw error;
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = str(args["baseUrl"]) ?? process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5180/";
  process.env["CLOD_POC_BASE_URL"] = baseUrl;
  const world = str(args["world"]) ?? "8";
  const warmupFrames = str(args["warmup"]) ?? "120";
  const sampleFrames = str(args["frames"]) ?? "300";
  const timeoutMs = Number(str(args["timeout"]) ?? 180000);
  const selectedCases = selectCases(str(args["case"]));
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const outDir = str(args["out"]) ?? join("perf-runs", `main-${runId}`);
  const renderer = str(args["renderer"]) ?? "webgpu";
  mkdirSync(outDir, { recursive: true });

  const baseParams: Record<string, string> = {
    world,
    seed: "1",
    webgpuSelection: "1",
    farShell: "1",
    freeze: str(args["freeze"]) ?? "1",
    perfProbe: "1",
    perfWarmup: warmupFrames,
    perfFrames: sampleFrames,
    profile: "0",
    ...parseParams(str(args["params"])),
  };

  const launcher = renderer === "webgl" ? launchChromium : launchWebGPU;
  const { browser, recipe } = await launcher();
  const results: PerfCaseResult[] = [];
  try {
    for (const perfCase of selectedCases) {
      results.push(await runCase(perfCase, baseParams, baseUrl, timeoutMs, browser, outDir));
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const summary = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    baseUrl,
    renderer,
    launchRecipe: recipe,
    baseParams,
    cases: results,
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(outDir, "summary.md"), markdown(results));
  console.log(`[perf-main] wrote ${join(outDir, "summary.json")}`);
  console.log(`[perf-main] wrote ${join(outDir, "summary.md")}`);
}

main().catch((error: unknown) => {
  console.error("[perf-main] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
