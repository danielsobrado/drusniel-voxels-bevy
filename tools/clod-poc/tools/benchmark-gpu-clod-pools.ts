import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";

const DEFAULT_RUNS = 3;
const DEFAULT_TIMEOUT_MS = 360_000;
const DEFAULT_MIN_PAGES = 8;
const POLL_INTERVAL_MS = 250;
const REQUIRED_STABLE_POLLS = 3;
const START_POSE = { p: [128, 96, 128] as [number, number, number], yaw: 2.65, pitch: -0.43, fov: 55 };
const TEST_POSE = { p: [2048, 96, 2048] as [number, number, number], yaw: 2.65, pitch: -0.43, fov: 55 };

interface BenchmarkOptions {
  runs: number;
  timeoutMs: number;
  minPages: number;
  out: string;
  maxDualRatio: number | null;
  allowHeaded: boolean;
}

interface Scenario {
  label: "single" | "dual";
  poolCount: 1 | 2;
}

interface CounterSnapshot {
  appError: string | null;
  poolCount: number;
  poolActive: number;
  poolMaxActive: number;
  poolWaiters: number;
  pagesDispatched: number;
  batchesDispatched: number;
  failedBatches: number;
  fallbackPages: number;
  workerFallbackPages: number;
  buildMsP50: number;
  buildMsP95: number;
  buildMsMax: number;
  countReadbackMsP95: number;
  geometryReadbackMsP95: number;
  readbackMsP95: number;
  streamPending: number;
  streamInflight: number;
  streamReady: number;
  streamActiveRoots: number;
  streamFailed: number;
  parentCoverageViolations: number;
}

interface RunResult {
  scenario: Scenario["label"];
  iteration: number;
  order: number;
  url: string;
  elapsedMs: number;
  pagesBuilt: number;
  snapshot: CounterSnapshot;
  consoleWarnings: string[];
}

const SCENARIOS: readonly Scenario[] = [
  { label: "single", poolCount: 1 },
  { label: "dual", poolCount: 2 },
];

function positiveIntegerArg(argv: readonly string[], key: string, fallback: number): number {
  const raw = argv.find((value) => value.startsWith(`${key}=`))?.slice(key.length + 1);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function positiveNumberArg(argv: readonly string[], key: string): number | null {
  const raw = argv.find((value) => value.startsWith(`${key}=`))?.slice(key.length + 1);
  if (raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${key} must be a positive number`);
  return parsed;
}

function outputPath(argv: readonly string[]): string {
  const raw = argv.find((value) => value.startsWith("--out="))?.slice("--out=".length);
  return resolve(raw || `perf-runs/gpu-clod-pools/${Date.now()}-summary.json`);
}

function parseOptions(argv: readonly string[]): BenchmarkOptions {
  return {
    runs: positiveIntegerArg(argv, "--runs", DEFAULT_RUNS),
    timeoutMs: positiveIntegerArg(argv, "--timeout", DEFAULT_TIMEOUT_MS),
    minPages: positiveIntegerArg(argv, "--min-pages", DEFAULT_MIN_PAGES),
    out: outputPath(argv),
    maxDualRatio: positiveNumberArg(argv, "--max-dual-ratio"),
    allowHeaded: argv.includes("--allow-headed"),
  };
}

async function readSnapshot(page: Page): Promise<CounterSnapshot> {
  return await page.evaluate(() => {
    const hooks = window.__drusnielClod;
    const counters = hooks?.stats?.counters ?? {};
    const value = (key: string): number => {
      const raw = counters[key];
      return Number.isFinite(raw) ? raw : 0;
    };
    return {
      appError: hooks?.error ?? null,
      poolCount: value("live_clod_stream_gpu_pool_count"),
      poolActive: value("live_clod_stream_gpu_pool_active"),
      poolMaxActive: value("live_clod_stream_gpu_pool_max_active"),
      poolWaiters: value("live_clod_stream_gpu_pool_waiters"),
      pagesDispatched: value("live_clod_stream_gpu_pages_dispatched"),
      batchesDispatched: value("live_clod_stream_gpu_batches_dispatched"),
      failedBatches: value("live_clod_stream_gpu_failed_batches"),
      fallbackPages: value("live_clod_stream_gpu_fallback_pages"),
      workerFallbackPages: value("live_clod_stream_worker_fallback_pages"),
      buildMsP50: value("live_clod_stream_gpu_build_ms_p50"),
      buildMsP95: value("live_clod_stream_gpu_build_ms_p95"),
      buildMsMax: value("live_clod_stream_gpu_build_ms_max"),
      countReadbackMsP95: value("live_clod_stream_gpu_count_readback_ms_p95"),
      geometryReadbackMsP95: value("live_clod_stream_gpu_geometry_readback_ms_p95"),
      readbackMsP95: value("live_clod_stream_gpu_readback_ms_p95"),
      streamPending: value("live_clod_stream_pending_pages"),
      streamInflight: value("live_clod_stream_inflight_batches"),
      streamReady: value("live_clod_stream_ready_pages"),
      streamActiveRoots: value("live_clod_stream_active_root_pages"),
      streamFailed: value("live_clod_stream_failed_pages"),
      parentCoverageViolations: value("live_clod_stream_parent_coverage_violations"),
    } satisfies CounterSnapshot;
  });
}

async function waitReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const hooks = window.__drusnielClod;
      return Boolean(hooks && (hooks.ready || hooks.error !== null));
    },
    undefined,
    { timeout: timeoutMs, polling: POLL_INTERVAL_MS },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(`application failed during startup: ${error}`);
}

async function waitForMeasuredStream(
  page: Page,
  scenario: Scenario,
  baselinePages: number,
  minPages: number,
  timeoutMs: number,
  pageErrors: readonly string[],
): Promise<{ elapsedMs: number; snapshot: CounterSnapshot }> {
  const startedAt = performance.now();
  const deadline = Date.now() + timeoutMs;
  let stablePolls = 0;
  let last = await readSnapshot(page);

  while (Date.now() < deadline) {
    if (pageErrors[0]) throw new Error(`page error: ${pageErrors[0]}`);
    last = await readSnapshot(page);
    if (last.appError) throw new Error(`application error: ${last.appError}`);

    const pagesBuilt = last.pagesDispatched - baselinePages;
    const overlapObserved = last.poolMaxActive >= scenario.poolCount;
    const quiet = pagesBuilt >= minPages
      && overlapObserved
      && last.poolActive === 0
      && last.streamPending === 0
      && last.streamInflight === 0
      && last.streamReady === 0
      && last.streamActiveRoots > 0;

    stablePolls = quiet ? stablePolls + 1 : 0;
    if (stablePolls >= REQUIRED_STABLE_POLLS) {
      return { elapsedMs: performance.now() - startedAt, snapshot: last };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `${scenario.label} timed out: pages=${last.pagesDispatched - baselinePages}/${minPages} `
    + `pool=${last.poolCount} active=${last.poolActive} maxActive=${last.poolMaxActive} waiters=${last.poolWaiters} `
    + `pending=${last.streamPending} inflight=${last.streamInflight} ready=${last.streamReady} activeRoots=${last.streamActiveRoots}`,
  );
}

function validateRun(result: RunResult, scenario: Scenario, minPages: number): void {
  const { snapshot } = result;
  const failures: string[] = [];
  if (snapshot.poolCount !== scenario.poolCount) failures.push(`poolCount=${snapshot.poolCount}, expected ${scenario.poolCount}`);
  if (snapshot.poolMaxActive < scenario.poolCount) failures.push(`poolMaxActive=${snapshot.poolMaxActive}, expected >= ${scenario.poolCount}`);
  if (result.pagesBuilt < minPages) failures.push(`pagesBuilt=${result.pagesBuilt}, expected >= ${minPages}`);
  if (snapshot.failedBatches !== 0) failures.push(`failedBatches=${snapshot.failedBatches}`);
  if (snapshot.fallbackPages !== 0) failures.push(`fallbackPages=${snapshot.fallbackPages}`);
  if (snapshot.workerFallbackPages !== 0) failures.push(`workerFallbackPages=${snapshot.workerFallbackPages}`);
  if (snapshot.streamFailed !== 0) failures.push(`streamFailed=${snapshot.streamFailed}`);
  if (snapshot.parentCoverageViolations !== 0) failures.push(`parentCoverageViolations=${snapshot.parentCoverageViolations}`);
  if (failures.length > 0) throw new Error(`${scenario.label} validation failed: ${failures.join(", ")}`);
}

function scenarioUrl(scenario: Scenario): string {
  return clodUrl({
    scene: "infinite-islands",
    seed: 1,
    hud: false,
    freeze: false,
    cam: `${START_POSE.p[0]},${START_POSE.p[1]},${START_POSE.p[2]},${START_POSE.yaw},${START_POSE.pitch},${START_POSE.fov}`,
    extra: {
      renderer: "webgpu",
      world: "4",
      startupWorld: "4",
      infiniteStartupWorld: "4",
      cache: "0",
      acceptance: "1",
      ownershipOracle: "0",
      x: String(START_POSE.p[0]),
      z: String(START_POSE.p[2]),
      yaw: String(START_POSE.yaw),
      liveBubble: "0",
      liveClodRootRadius: "512",
      liveClodRootGpuMesher: "1",
      liveClodRootGpuBatchSize: "1",
      liveClodRootGpuMaxInflightBatches: String(scenario.poolCount),
      liveClodRootMaxInflightBatches: String(scenario.poolCount),
      liveClodRootBudget: "16",
      liveClodRootApplyBudget: "16",
      liveClodRootMaxCached: "512",
      liveClodRootMaxLevel: "1",
      farClipmap: "0",
      canopy: "0",
      trees: "0",
      treeGpu: "0",
      stoneGpu: "0",
      understoryGpu: "0",
      grassGpu: "0",
      sunLightCache: "0",
      sceneCompileWarm: "0",
    },
  });
}

async function runScenario(
  context: BrowserContext,
  scenario: Scenario,
  iteration: number,
  order: number,
  options: BenchmarkOptions,
): Promise<RunResult> {
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning") consoleWarnings.push(message.text());
  });
  const url = scenarioUrl(scenario);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitReady(page, options.timeoutMs);
    await page.evaluate(async () => {
      await window.__drusnielClod?.settle?.(30);
    });
    const initialBaseline = await readSnapshot(page);
    await waitForMeasuredStream(
      page,
      scenario,
      initialBaseline.pagesDispatched,
      0,
      options.timeoutMs,
      pageErrors,
    );
    const baseline = await readSnapshot(page);
    await page.evaluate((pose) => {
      const hooks = window.__drusnielClod;
      hooks?.beginMovementRouteProbe?.();
      if (hooks?.resetAcceptanceSceneForPose) hooks.resetAcceptanceSceneForPose(pose);
      else hooks?.setPose?.(pose);
    }, TEST_POSE);

    const measured = await waitForMeasuredStream(
      page,
      scenario,
      baseline.pagesDispatched,
      options.minPages,
      options.timeoutMs,
      pageErrors,
    );
    const result: RunResult = {
      scenario: scenario.label,
      iteration,
      order,
      url,
      elapsedMs: measured.elapsedMs,
      pagesBuilt: measured.snapshot.pagesDispatched - baseline.pagesDispatched,
      snapshot: measured.snapshot,
      consoleWarnings: consoleWarnings.slice(0, 20),
    };
    validateRun(result, scenario, options.minPages);
    return result;
  } finally {
    await page.close();
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function summarize(runs: readonly RunResult[]): Record<string, unknown> {
  const single = runs.filter((run) => run.scenario === "single");
  const dual = runs.filter((run) => run.scenario === "dual");
  const singleMedianMs = median(single.map((run) => run.elapsedMs));
  const dualMedianMs = median(dual.map((run) => run.elapsedMs));
  const dualToSingleRatio = singleMedianMs > 0 ? dualMedianMs / singleMedianMs : 0;
  return {
    singleMedianMs,
    dualMedianMs,
    dualToSingleRatio,
    speedup: dualMedianMs > 0 ? singleMedianMs / dualMedianMs : 0,
    singleBuildMsP95Median: median(single.map((run) => run.snapshot.buildMsP95)),
    dualBuildMsP95Median: median(dual.map((run) => run.snapshot.buildMsP95)),
    singleReadbackMsP95Median: median(single.map((run) => run.snapshot.readbackMsP95)),
    dualReadbackMsP95Median: median(dual.map((run) => run.snapshot.readbackMsP95)),
  };
}

function printRows(runs: readonly RunResult[]): void {
  console.table(runs.map((run) => ({
    scenario: run.scenario,
    iteration: run.iteration,
    elapsedMs: Math.round(run.elapsedMs),
    pagesBuilt: run.pagesBuilt,
    poolMaxActive: run.snapshot.poolMaxActive,
    buildP95Ms: Number(run.snapshot.buildMsP95.toFixed(2)),
    readbackP95Ms: Number(run.snapshot.readbackMsP95.toFixed(2)),
  })));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  process.env["CLOD_POC_BROWSER_CHANNEL"] ??= "chromium";
  const { browser, recipe } = await launchWebGPU();
  if (!recipe.headless && !options.allowHeaded) {
    await browser.close();
    throw new Error("WebGPU was only available in a headed browser; this benchmark requires headless mode. Pass --allow-headed only for local diagnosis.");
  }

  const runs: RunResult[] = [];
  try {
    for (let iteration = 1; iteration <= options.runs; iteration++) {
      const ordered = iteration % 2 === 1 ? SCENARIOS : [...SCENARIOS].reverse();
      for (let order = 0; order < ordered.length; order++) {
        const scenario = ordered[order]!;
        console.log(`[gpu-clod-pools] run=${iteration}/${options.runs} scenario=${scenario.label}`);
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        try {
          runs.push(await runScenario(context, scenario, iteration, order, options));
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const summary = summarize(runs);
  const ratio = Number(summary["dualToSingleRatio"] ?? 0);
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    browserRecipe: recipe,
    options,
    summary,
    runs,
  };
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(output, null, 2)}\n`);
  printRows(runs);
  console.log(`[gpu-clod-pools] summary ${JSON.stringify(summary)}`);
  console.log(`[gpu-clod-pools] wrote ${options.out}`);

  if (options.maxDualRatio !== null && ratio > options.maxDualRatio) {
    throw new Error(`dual/single median ratio ${ratio.toFixed(3)} exceeds ${options.maxDualRatio.toFixed(3)}`);
  }
}

main().catch((error) => {
  console.error("[gpu-clod-pools] FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
