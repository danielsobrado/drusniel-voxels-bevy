import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";

const DEFAULT_RUNS = 4;
const DEFAULT_WARMUP_PAIRS = 1;
const DEFAULT_TIMEOUT_MS = 360_000;
const DEFAULT_MIN_PAGES = 8;
const POLL_INTERVAL_MS = 50;
const REQUIRED_STABLE_POLLS = 3;
const MAX_CAPTURED_MESSAGES = 20;
const START_POSE = { p: [128, 96, 128] as [number, number, number], yaw: 2.65, pitch: -0.43, fov: 55 };
const TEST_POSE = { p: [2048, 96, 2048] as [number, number, number], yaw: 2.65, pitch: -0.43, fov: 55 };
const CONSOLE_ERROR_ALLOWLIST = [
  /favicon\.ico.*404/i,
  /Failed to load resource: the server responded with a status of 404.*favicon/i,
] as const;

interface BenchmarkOptions {
  runs: number;
  warmupPairs: number;
  timeoutMs: number;
  minPages: number;
  out: string;
  maxDualRatio: number | null;
  allowHeaded: boolean;
  allowSoftware: boolean;
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
  poolOverlapEventsTotal: number;
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
  probeRequestedPages: number;
  probeAppliedPages: number;
  probeStaleDiscards: number;
}

interface RuntimeMessages {
  pageErrors: string[];
  consoleErrors: string[];
  consoleWarnings: string[];
}

interface StreamMeasurement {
  timeToFirstQuietMs: number;
  stabilizedElapsedMs: number;
  snapshot: CounterSnapshot;
}

interface RunResult {
  kind: "warmup" | "measured";
  scenario: Scenario["label"];
  iteration: number;
  order: number;
  url: string;
  timeToFirstQuietMs: number;
  stabilizedElapsedMs: number;
  pagesDispatched: number;
  pagesRequested: number;
  pagesApplied: number;
  overlapEventsDelta: number;
  snapshot: CounterSnapshot;
  consoleWarnings: string[];
}

const SCENARIOS: readonly Scenario[] = [
  { label: "single", poolCount: 1 },
  { label: "dual", poolCount: 2 },
];

function integerArg(argv: readonly string[], key: string, fallback: number, allowZero: boolean): number {
  const raw = argv.find((value) => value.startsWith(`${key}=`))?.slice(key.length + 1);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${key} must be an integer >= ${minimum}`);
  return parsed;
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
  const runs = integerArg(argv, "--runs", DEFAULT_RUNS, false);
  if (runs % 2 !== 0) throw new Error("--runs must be even so single/dual execution order is balanced");
  return {
    runs,
    warmupPairs: integerArg(argv, "--warmup-pairs", DEFAULT_WARMUP_PAIRS, true),
    timeoutMs: integerArg(argv, "--timeout", DEFAULT_TIMEOUT_MS, false),
    minPages: integerArg(argv, "--min-pages", DEFAULT_MIN_PAGES, false),
    out: outputPath(argv),
    maxDualRatio: positiveNumberArg(argv, "--max-dual-ratio"),
    allowHeaded: argv.includes("--allow-headed"),
    allowSoftware: argv.includes("--allow-software"),
  };
}

function isSoftwareRecipe(recipe: { args: readonly string[] }): boolean {
  return recipe.args.some((arg) => arg.toLowerCase().includes("swiftshader"));
}

function isAllowedConsoleError(message: string): boolean {
  return CONSOLE_ERROR_ALLOWLIST.some((pattern) => pattern.test(message));
}

function firstRuntimeError(messages: RuntimeMessages): string | null {
  if (messages.pageErrors[0]) return `page error: ${messages.pageErrors[0]}`;
  if (messages.consoleErrors[0]) return `console error: ${messages.consoleErrors[0]}`;
  return null;
}

function captureRuntimeMessages(page: Page): RuntimeMessages {
  const messages: RuntimeMessages = { pageErrors: [], consoleErrors: [], consoleWarnings: [] };
  page.on("pageerror", (error) => {
    if (messages.pageErrors.length < MAX_CAPTURED_MESSAGES) messages.pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !isAllowedConsoleError(text) && messages.consoleErrors.length < MAX_CAPTURED_MESSAGES) {
      messages.consoleErrors.push(text);
    }
    if (message.type() === "warning" && messages.consoleWarnings.length < MAX_CAPTURED_MESSAGES) {
      messages.consoleWarnings.push(text);
    }
  });
  return messages;
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
      poolOverlapEventsTotal: value("live_clod_stream_gpu_pool_overlap_events_total"),
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
      probeRequestedPages: value("live_clod_stream_probe_requested_pages_total"),
      probeAppliedPages: value("live_clod_stream_probe_apply_pages_total"),
      probeStaleDiscards: value("live_clod_stream_probe_stale_discards_total"),
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

function fatalSnapshotFailure(snapshot: CounterSnapshot): string | null {
  if (snapshot.failedBatches !== 0) return `failedBatches=${snapshot.failedBatches}`;
  if (snapshot.fallbackPages !== 0) return `fallbackPages=${snapshot.fallbackPages}`;
  if (snapshot.workerFallbackPages !== 0) return `workerFallbackPages=${snapshot.workerFallbackPages}`;
  if (snapshot.streamFailed !== 0) return `streamFailed=${snapshot.streamFailed}`;
  return null;
}

async function waitForBaselineQuiet(
  page: Page,
  scenario: Scenario,
  timeoutMs: number,
  messages: RuntimeMessages,
): Promise<CounterSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let stablePolls = 0;
  let last = await readSnapshot(page);

  while (Date.now() < deadline) {
    const runtimeError = firstRuntimeError(messages);
    if (runtimeError) throw new Error(runtimeError);
    last = await readSnapshot(page);
    if (last.appError) throw new Error(`application error: ${last.appError}`);
    const fatal = fatalSnapshotFailure(last);
    if (fatal) throw new Error(fatal);

    const quiet = last.poolCount === scenario.poolCount
      && last.poolActive === 0
      && last.poolWaiters === 0
      && last.streamPending === 0
      && last.streamInflight === 0
      && last.streamReady === 0
      && last.streamActiveRoots > 0
      && last.parentCoverageViolations === 0;
    stablePolls = quiet ? stablePolls + 1 : 0;
    if (stablePolls >= REQUIRED_STABLE_POLLS) return last;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `${scenario.label} baseline timed out: pool=${last.poolCount} active=${last.poolActive} waiters=${last.poolWaiters} `
    + `pending=${last.streamPending} inflight=${last.streamInflight} ready=${last.streamReady} activeRoots=${last.streamActiveRoots}`,
  );
}

async function waitForMeasuredStream(
  page: Page,
  scenario: Scenario,
  baseline: CounterSnapshot,
  minPages: number,
  timeoutMs: number,
  startedAt: number,
  messages: RuntimeMessages,
): Promise<StreamMeasurement> {
  const deadline = Date.now() + timeoutMs;
  let firstQuietMs: number | null = null;
  let stablePolls = 0;
  let last = await readSnapshot(page);

  while (Date.now() < deadline) {
    const runtimeError = firstRuntimeError(messages);
    if (runtimeError) throw new Error(runtimeError);
    last = await readSnapshot(page);
    if (last.appError) throw new Error(`application error: ${last.appError}`);
    const fatal = fatalSnapshotFailure(last);
    if (fatal) throw new Error(fatal);
    if (last.probeStaleDiscards !== 0) throw new Error(`probeStaleDiscards=${last.probeStaleDiscards}`);

    const overlapEventsDelta = last.poolOverlapEventsTotal - baseline.poolOverlapEventsTotal;
    const overlapSatisfied = scenario.poolCount === 1 ? overlapEventsDelta === 0 : overlapEventsDelta > 0;
    const quiet = last.poolCount === scenario.poolCount
      && last.probeRequestedPages >= minPages
      && last.probeAppliedPages >= minPages
      && overlapSatisfied
      && last.poolActive === 0
      && last.poolWaiters === 0
      && last.streamPending === 0
      && last.streamInflight === 0
      && last.streamReady === 0
      && last.streamActiveRoots > 0
      && last.parentCoverageViolations === 0;

    if (quiet) {
      firstQuietMs ??= performance.now() - startedAt;
      stablePolls++;
    } else {
      firstQuietMs = null;
      stablePolls = 0;
    }
    if (stablePolls >= REQUIRED_STABLE_POLLS) {
      return {
        timeToFirstQuietMs: firstQuietMs ?? performance.now() - startedAt,
        stabilizedElapsedMs: performance.now() - startedAt,
        snapshot: last,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `${scenario.label} measured pass timed out: applied=${last.probeAppliedPages}/${minPages} `
    + `requested=${last.probeRequestedPages} stale=${last.probeStaleDiscards} `
    + `overlapDelta=${last.poolOverlapEventsTotal - baseline.poolOverlapEventsTotal} `
    + `pool=${last.poolCount} active=${last.poolActive} waiters=${last.poolWaiters} `
    + `pending=${last.streamPending} inflight=${last.streamInflight} ready=${last.streamReady} activeRoots=${last.streamActiveRoots}`,
  );
}

function validateProbeReset(snapshot: CounterSnapshot): void {
  const failures: string[] = [];
  if (snapshot.probeRequestedPages !== 0) failures.push(`requested=${snapshot.probeRequestedPages}`);
  if (snapshot.probeAppliedPages !== 0) failures.push(`applied=${snapshot.probeAppliedPages}`);
  if (snapshot.probeStaleDiscards !== 0) failures.push(`stale=${snapshot.probeStaleDiscards}`);
  if (failures.length > 0) throw new Error(`movement probe did not reset cleanly: ${failures.join(", ")}`);
}

function validateRun(result: RunResult, scenario: Scenario, minPages: number): void {
  const { snapshot } = result;
  const failures: string[] = [];
  if (snapshot.poolCount !== scenario.poolCount) failures.push(`poolCount=${snapshot.poolCount}, expected ${scenario.poolCount}`);
  if (result.pagesRequested < minPages) failures.push(`pagesRequested=${result.pagesRequested}, expected >= ${minPages}`);
  if (result.pagesApplied < minPages) failures.push(`pagesApplied=${result.pagesApplied}, expected >= ${minPages}`);
  if (result.pagesDispatched < minPages) failures.push(`pagesDispatched=${result.pagesDispatched}, expected >= ${minPages}`);
  if (scenario.poolCount === 1 && result.overlapEventsDelta !== 0) failures.push(`serial overlapEventsDelta=${result.overlapEventsDelta}`);
  if (scenario.poolCount === 2 && result.overlapEventsDelta <= 0) failures.push("dual pool did not overlap during measured phase");
  if (snapshot.probeStaleDiscards !== 0) failures.push(`probeStaleDiscards=${snapshot.probeStaleDiscards}`);
  const fatal = fatalSnapshotFailure(snapshot);
  if (fatal) failures.push(fatal);
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
  kind: RunResult["kind"],
  iteration: number,
  order: number,
  options: BenchmarkOptions,
): Promise<RunResult> {
  const page = await context.newPage();
  const messages = captureRuntimeMessages(page);
  const url = scenarioUrl(scenario);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitReady(page, options.timeoutMs);
    await page.evaluate(async () => {
      await window.__drusnielClod?.settle?.(30);
    });
    await waitForBaselineQuiet(page, scenario, options.timeoutMs, messages);

    await page.evaluate(() => window.__drusnielClod?.beginMovementRouteProbe?.());
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const probeBaseline = await readSnapshot(page);
    validateProbeReset(probeBaseline);

    const startedAt = performance.now();
    await page.evaluate((pose) => {
      const hooks = window.__drusnielClod;
      if (hooks?.resetAcceptanceSceneForPose) hooks.resetAcceptanceSceneForPose(pose);
      else hooks?.setPose?.(pose);
    }, TEST_POSE);

    const measured = await waitForMeasuredStream(
      page,
      scenario,
      probeBaseline,
      options.minPages,
      options.timeoutMs,
      startedAt,
      messages,
    );
    const overlapEventsDelta = measured.snapshot.poolOverlapEventsTotal - probeBaseline.poolOverlapEventsTotal;
    const result: RunResult = {
      kind,
      scenario: scenario.label,
      iteration,
      order,
      url,
      timeToFirstQuietMs: measured.timeToFirstQuietMs,
      stabilizedElapsedMs: measured.stabilizedElapsedMs,
      pagesDispatched: measured.snapshot.pagesDispatched - probeBaseline.pagesDispatched,
      pagesRequested: measured.snapshot.probeRequestedPages,
      pagesApplied: measured.snapshot.probeAppliedPages,
      overlapEventsDelta,
      snapshot: measured.snapshot,
      consoleWarnings: messages.consoleWarnings,
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

function summarize(runs: readonly RunResult[]): Record<string, number> {
  const single = runs.filter((run) => run.scenario === "single");
  const dual = runs.filter((run) => run.scenario === "dual");
  const singleFirstQuietMedianMs = median(single.map((run) => run.timeToFirstQuietMs));
  const dualFirstQuietMedianMs = median(dual.map((run) => run.timeToFirstQuietMs));
  const dualToSingleRatio = singleFirstQuietMedianMs > 0 ? dualFirstQuietMedianMs / singleFirstQuietMedianMs : 0;
  return {
    singleFirstQuietMedianMs,
    dualFirstQuietMedianMs,
    dualToSingleRatio,
    speedup: dualFirstQuietMedianMs > 0 ? singleFirstQuietMedianMs / dualFirstQuietMedianMs : 0,
    singleStabilizedMedianMs: median(single.map((run) => run.stabilizedElapsedMs)),
    dualStabilizedMedianMs: median(dual.map((run) => run.stabilizedElapsedMs)),
    singleBuildMsP95Median: median(single.map((run) => run.snapshot.buildMsP95)),
    dualBuildMsP95Median: median(dual.map((run) => run.snapshot.buildMsP95)),
    singleReadbackMsP95Median: median(single.map((run) => run.snapshot.readbackMsP95)),
    dualReadbackMsP95Median: median(dual.map((run) => run.snapshot.readbackMsP95)),
  };
}

function printRows(runs: readonly RunResult[]): void {
  console.table(runs.map((run) => ({
    kind: run.kind,
    scenario: run.scenario,
    iteration: run.iteration,
    firstQuietMs: Math.round(run.timeToFirstQuietMs),
    stabilizedMs: Math.round(run.stabilizedElapsedMs),
    applied: run.pagesApplied,
    overlapEvents: run.overlapEventsDelta,
    buildP95Ms: Number(run.snapshot.buildMsP95.toFixed(2)),
    readbackP95Ms: Number(run.snapshot.readbackMsP95.toFixed(2)),
  })));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  process.env["CLOD_POC_BROWSER_CHANNEL"] ??= "chromium";
  const { browser, recipe } = await launchWebGPU();
  const softwareRenderer = isSoftwareRecipe(recipe);
  if (!recipe.headless && !options.allowHeaded) {
    await browser.close();
    throw new Error("WebGPU was only available in a headed browser; pass --allow-headed only for local diagnosis");
  }
  if (softwareRenderer && options.maxDualRatio !== null) {
    await browser.close();
    throw new Error("Performance ratios are invalid under SwiftShader; run the gate on a hardware WebGPU adapter");
  }
  if (softwareRenderer && !options.allowSoftware) {
    await browser.close();
    throw new Error("WebGPU resolved to SwiftShader; pass --allow-software for correctness-only execution");
  }

  const warmups: RunResult[] = [];
  const runs: RunResult[] = [];
  try {
    for (let pair = 1; pair <= options.warmupPairs; pair++) {
      for (let order = 0; order < SCENARIOS.length; order++) {
        const scenario = SCENARIOS[order]!;
        console.log(`[gpu-clod-pools] warmup=${pair}/${options.warmupPairs} scenario=${scenario.label}`);
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        try {
          warmups.push(await runScenario(context, scenario, "warmup", pair, order, options));
        } finally {
          await context.close();
        }
      }
    }

    for (let iteration = 1; iteration <= options.runs; iteration++) {
      const ordered = iteration % 2 === 1 ? SCENARIOS : [...SCENARIOS].reverse();
      for (let order = 0; order < ordered.length; order++) {
        const scenario = ordered[order]!;
        console.log(`[gpu-clod-pools] run=${iteration}/${options.runs} scenario=${scenario.label}`);
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        try {
          runs.push(await runScenario(context, scenario, "measured", iteration, order, options));
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const summary = summarize(runs);
  const ratio = summary.dualToSingleRatio;
  const output = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    browserRecipe: recipe,
    softwareRenderer,
    options,
    summary,
    warmups,
    runs,
  };
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(output, null, 2)}\n`);
  printRows([...warmups, ...runs]);
  console.log(`[gpu-clod-pools] summary ${JSON.stringify(summary)}`);
  console.log(`[gpu-clod-pools] wrote ${options.out}`);

  if (options.maxDualRatio !== null && ratio > options.maxDualRatio) {
    throw new Error(`dual/single first-quiet median ratio ${ratio.toFixed(3)} exceeds ${options.maxDualRatio.toFixed(3)}`);
  }
}

main().catch((error) => {
  console.error("[gpu-clod-pools] FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
