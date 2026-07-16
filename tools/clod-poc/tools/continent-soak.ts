import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";
import { gitSha, hostEnvironmentRecord } from "./infinite_acceptance/host_environment.js";
import { resolveMovementRouteProfile } from "./infinite_acceptance/movement_route_profile.js";
import {
  evaluateSoak,
  type SoakEvaluation,
  type SoakMinuteSample,
  type SoakThresholds,
} from "./long_map_soak_analysis.js";

type Args = Record<string, string | boolean>;

interface RecoveryEvidence {
  name: "background-foreground";
  recoveryMs: number;
  passed: boolean;
  blockers: string[];
  counters: Record<string, number>;
}

const route = resolveMovementRouteProfile("coast-to-coast");

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index];
    if (!raw?.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index++;
    } else out[key] = true;
  }
  return out;
}

function stringArg(args: Args, key: string): string | undefined {
  return typeof args[key] === "string" ? args[key] : undefined;
}

function routePose(progress: number): [number, number] {
  const start = route.start ?? [-8_000, 96, 0];
  const points: Array<[number, number]> = [[start[0], start[2]]];
  for (const segment of route.segments) {
    const previous = points.at(-1)!;
    points.push([previous[0] + segment.dx, previous[1] + segment.dz]);
  }
  const lengths = route.segments.map((segment) => Math.hypot(segment.dx, segment.dz));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let target = Math.min(1, Math.max(0, progress)) * total;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (target <= length) {
      const t = length > 0 ? target / length : 0;
      const from = points[index]!;
      const to = points[index + 1]!;
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    }
    target -= length;
  }
  return points.at(-1)!;
}

async function waitReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => window.__drusnielClod?.ready === true || window.__drusnielClod?.error !== null,
    undefined,
    { timeout: timeoutMs, polling: 250 },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(error);
}

async function setPoseAndSettle(page: Page, x: number, z: number, frames: number): Promise<void> {
  await page.evaluate(async ({ nextX, nextZ, settleFrames }) => {
    const hooks = window.__drusnielClod;
    const pose = hooks?.getPose?.();
    if (!pose || !hooks?.setPose || !hooks.settle) throw new Error("continent soak requires pose and settle hooks");
    hooks.setPose({ ...pose, p: [nextX, pose.p[1], nextZ] });
    await hooks.settle(settleFrames);
  }, { nextX: x, nextZ: z, settleFrames: frames });
}

async function readMinuteSample(page: Page, minute: number): Promise<SoakMinuteSample> {
  return await page.evaluate((sampleMinute) => {
    const hooks = window.__drusnielClod;
    const counters = { ...(hooks?.stats?.counters ?? {}) };
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    const usedJsHeapBytes = Number(memory?.usedJSHeapSize);
    const exposedGc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    if (typeof exposedGc === "function") exposedGc();
    const postGcHeapFloorBytes = typeof exposedGc === "function"
      ? Number((performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize)
      : Number.NaN;
    const recent = (window as typeof window & {
      __drusnielPerf?: { recentSamples?: Array<{ frameMs?: number }> };
    }).__drusnielPerf?.recentSamples ?? [];
    const frameMs = recent.map((sample) => Number(sample.frameMs)).filter(Number.isFinite).sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(frameMs.length * 0.95) - 1);
    const routeCounters = new Set([
      "draw_calls",
      "total_scene_tris",
      "priority_unowned_cells",
      "clod_far_gap_holes",
      "far_clipmap_ownership_holes",
    ]);
    const resourceCounters = Object.fromEntries(Object.entries(counters).filter(([key]) =>
      routeCounters.has(key) || /(bytes|resident|cached|cache_size|queue|pending|inflight|geometries|textures|programs|buffers|bind_groups)/.test(key)));
    const estimatedVramBytes = Object.entries(resourceCounters)
      .filter(([key]) => /(bytes_resident|gpu_buffer_bytes|gpu_texture_bytes)/.test(key) && !/(transfer|upload|total)/.test(key))
      .reduce((sum, [, value]) => sum + Math.max(0, value), 0);
    return {
      minute: sampleMinute,
      usedJsHeapBytes: Number.isFinite(usedJsHeapBytes) ? usedJsHeapBytes : null,
      postGcHeapFloorBytes: Number.isFinite(postGcHeapFloorBytes) ? postGcHeapFloorBytes : null,
      estimatedVramBytes,
      frameMsP95: frameMs[p95Index] ?? hooks?.stats?.frameMsP95 ?? 0,
      queuesDrained: [
        "heightfield_tiles_pending",
        "heightfield_tiles_inflight",
        "live_bubble_building_pages",
        "live_clod_stream_safety_pending_pages",
        "live_clod_stream_safety_inflight_pages",
        "clodApplyQueueDepth",
        "clodColliderQueueDepth",
      ].every((key) => (counters[key] ?? 0) === 0),
      counters: resourceCounters,
    };
  }, minute);
}

async function runWander(page: Page, minutes: number): Promise<SoakMinuteSample[]> {
  const samples: SoakMinuteSample[] = [await readMinuteSample(page, 0)];
  for (let minute = 1; minute <= minutes; minute++) {
    for (let second = 0; second < 60; second++) {
      const elapsedMinutes = minute - 1 + second / 60;
      const cycle = (elapsedMinutes % 6) / 3;
      const progress = cycle <= 1 ? cycle : 2 - cycle;
      const [x, z] = routePose(progress);
      await setPoseAndSettle(page, x, z, 60);
    }
    const sample = await readMinuteSample(page, minute);
    samples.push(sample);
    console.log(`[continent-soak] minute=${minute} heap=${sample.usedJsHeapBytes ?? "n/a"} vramEstimate=${sample.estimatedVramBytes} frameP95=${sample.frameMsP95.toFixed(2)}ms`);
  }
  return samples;
}

async function readCounters(page: Page): Promise<Record<string, number>> {
  return await page.evaluate(() => ({ ...(window.__drusnielClod?.stats?.counters ?? {}) }));
}

function queueDrainBlockers(counters: Readonly<Record<string, number>>): string[] {
  const keys = [
    "heightfield_tiles_pending",
    "heightfield_tiles_inflight",
    "live_bubble_building_pages",
    "live_clod_stream_safety_pending_pages",
    "live_clod_stream_safety_inflight_pages",
    "clodApplyQueueDepth",
    "clodColliderQueueDepth",
  ] as const;
  return keys.flatMap((key) => (counters[key] ?? 0) === 0 ? [] : [`${key}=${counters[key]}`]);
}

async function waitForQueueDrain(page: Page, timeoutMs: number): Promise<RecoveryEvidence> {
  const startedAt = performance.now();
  let counters = await readCounters(page);
  let blockers = queueDrainBlockers(counters);
  while (blockers.length > 0 && performance.now() - startedAt < timeoutMs) {
    await page.evaluate(() => window.__drusnielClod?.settle?.(5));
    counters = await readCounters(page);
    blockers = queueDrainBlockers(counters);
  }
  const recoveryMs = performance.now() - startedAt;
  return { name: "background-foreground", recoveryMs, passed: blockers.length === 0 && recoveryMs <= timeoutMs, blockers, counters };
}

async function backgroundForeground(page: Page, timeoutMs: number, seconds: number): Promise<RecoveryEvidence> {
  const background = await page.context().newPage();
  await background.goto("about:blank");
  await background.bringToFront();
  await page.waitForTimeout(seconds * 1_000);
  await page.bringToFront();
  await background.close();
  return await waitForQueueDrain(page, timeoutMs);
}

function recoveryFailures(recovery: readonly RecoveryEvidence[], thresholds: SoakThresholds | null): string[] {
  if (!thresholds) return [];
  return recovery.flatMap((entry) => {
    if (!entry.passed) return [`${entry.name} did not recover: ${entry.blockers.join(", ")}`];
    if (entry.recoveryMs > thresholds.maxBackgroundRecoveryMs) return [`${entry.name} recovery ${entry.recoveryMs.toFixed(0)}ms > ${thresholds.maxBackgroundRecoveryMs}ms`];
    return [];
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const minutes = Math.max(0, Number(stringArg(args, "minutes") ?? 60));
  const backgroundSeconds = Math.max(0, Number(stringArg(args, "background-seconds") ?? 60));
  const timeoutMs = Math.max(1_000, Number(stringArg(args, "recovery-timeout-ms") ?? 180_000));
  const outDir = resolve(stringArg(args, "out") ?? join("soak-runs", new Date().toISOString().replace(/[:.]/g, "-")));
  const thresholdsPath = resolve(stringArg(args, "thresholds") ?? join("config", "long_map_soak_thresholds.json"));
  const calibrate = args["calibrate"] === true;
  const thresholds = existsSync(thresholdsPath)
    ? JSON.parse(readFileSync(thresholdsPath, "utf8")) as SoakThresholds
    : null;
  if (!thresholds && !calibrate) throw new Error(`soak thresholds are missing at ${thresholdsPath}; run with --calibrate to capture baseline evidence`);
  mkdirSync(outDir, { recursive: true });
  const { browser, recipe } = await launchWebGPU();
  const browserVersion = browser.version();
  let samples: SoakMinuteSample[] = [];
  let recovery: RecoveryEvidence[] = [];
  let runUrl = "";
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const start = route.start ?? [-8_000, 96, 0];
    const url = clodUrl({
      scene: "infinite-islands",
      seed: 1,
      extra: {
        x: String(start[0]), z: String(start[2]), yaw: "1.5708", world: "16", startupWorld: "4",
        clodPerf: "1", perfProbe: "1", perfWarmupFrames: "0", perfSampleFrames: "1320",
        ownershipOracle: "1", acceptance: "1", liveClodRootBudget: "2", liveClodRootMaxCached: "4",
        farSummaryLayout: "2", farClipmap: "1", farClipmapMode: "replace",
      },
    });
    runUrl = url;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitReady(page, 360_000);
    await page.evaluate(() => window.__drusnielClod?.settle?.(600));
    await page.evaluate(() => window.__drusnielClod?.beginMovementRouteProbe?.());
    samples = await runWander(page, minutes);
    recovery = [
      await backgroundForeground(page, timeoutMs, backgroundSeconds),
    ];
  } finally {
    await browser.close();
  }
  // The --minutes 0 recovery drill exercises background/foreground recovery only;
  // soak envelopes need a wander window and would fail closed on an empty one.
  const evaluation: SoakEvaluation | null = thresholds && minutes > 0 ? evaluateSoak(samples, thresholds) : null;
  const failures = [...(evaluation?.failures ?? []), ...recoveryFailures(recovery, thresholds)];
  const report = {
    createdAt: new Date().toISOString(),
    minutes,
    thresholdsPath,
    thresholds,
    calibrationRequired: thresholds === null,
    browserRecipe: recipe,
    environment: {
      ...hostEnvironmentRecord(),
      commitSha: gitSha(),
      browserVersion,
      captureViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      url: runUrl,
      cacheState: "fresh Playwright profile",
    },
    samples,
    evaluation,
    recovery,
    teleport: {
      status: "blocked",
      dependency: "playable-world plan P1 time_to_gameplay_ready_ms contract",
      note: "No interim readiness predicate is used by this tool.",
    },
    deviceLoss: {
      contract: "fail-loud",
      manualProcedure: "Open DevTools, obtain the active GPUDevice, call device.destroy(), and verify window.__drusnielClod.error plus the fatal overlay report WebGPU device loss.",
    },
    passed: thresholds !== null && failures.length === 0,
    failures,
  };
  const reportPath = join(outDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[continent-soak] report: ${reportPath}`);
  if (thresholds && failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[continent-soak] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
