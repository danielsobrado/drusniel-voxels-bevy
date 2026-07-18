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

interface TeleportEvidence {
  name: "2km" | "8km" | "rim-to-rim";
  distanceM: number;
  from: readonly [number, number];
  to: readonly [number, number];
  timeToGameplayReadyMs: number;
  readinessPolls: number;
  passed: boolean;
  blockers: string[];
  counters: Record<string, number>;
}

interface DeviceLossEvidence {
  requested: boolean;
  error: string | null;
  editRevision: number | null;
  voxelDeltaCountBefore: number | null;
  voxelDeltaCountAfter: number | null;
  persistenceErrorAfter: number | null;
  controlledReloadInstalled: boolean;
  passed: boolean;
  failures: string[];
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
    () => window.__drusnielClod?.ready === true || window.__drusnielClod?.error != null,
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

async function readMinuteSample(page: Page, minute: number, collectGarbage: () => Promise<void>): Promise<SoakMinuteSample> {
  const usedJsHeapBytes = await page.evaluate(() => Number(
    (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize,
  ));
  await collectGarbage();
  return await page.evaluate(({ sampleMinute, heapBeforeGc }) => {
    const hooks = window.__drusnielClod;
    const counters = { ...(hooks?.stats?.counters ?? {}) };
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    const postGcHeapFloorBytes = Number(memory?.usedJSHeapSize);
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
      usedJsHeapBytes: Number.isFinite(heapBeforeGc) ? heapBeforeGc : null,
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
  }, { sampleMinute: minute, heapBeforeGc: usedJsHeapBytes });
}

async function runWander(page: Page, minutes: number, collectGarbage: () => Promise<void>): Promise<SoakMinuteSample[]> {
  const samples: SoakMinuteSample[] = [await readMinuteSample(page, 0, collectGarbage)];
  for (let minute = 1; minute <= minutes; minute++) {
    for (let second = 0; second < 60; second++) {
      const elapsedMinutes = minute - 1 + second / 60;
      const cycle = (elapsedMinutes % 6) / 3;
      const progress = cycle <= 1 ? cycle : 2 - cycle;
      const [x, z] = routePose(progress);
      await setPoseAndSettle(page, x, z, 60);
    }
    const sample = await readMinuteSample(page, minute, collectGarbage);
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

function teleportCoverageBlockers(counters: Readonly<Record<string, number>>): string[] {
  const requiredZero = [
    "priority_unowned_cells",
    "clod_far_gap_holes",
    "far_clipmap_ownership_holes",
    "far_clipmap_fallback_samples_this_frame",
    "heightfield_tiles_fallback_samples_this_frame",
  ] as const;
  return requiredZero.flatMap((key) => {
    const value = counters[key];
    if (!Number.isFinite(value)) return [`${key}=missing`];
    return value === 0 ? [] : [`${key}=${value}`];
  });
}

async function gameplayTeleport(
  page: Page,
  name: TeleportEvidence["name"],
  from: readonly [number, number],
  to: readonly [number, number],
  timeoutMs: number,
): Promise<TeleportEvidence> {
  const readiness = await page.evaluate(async ({ x, z, timeout }) => {
    const teleport = window.__drusnielClod?.teleportGameplayTarget;
    if (!teleport) throw new Error("continent teleport drill requires the P1 teleportGameplayTarget hook");
    return await teleport({ x, z, timeoutMs: timeout });
  }, { x: to[0], z: to[1], timeout: timeoutMs });
  await page.evaluate(() => window.__drusnielClod?.settle?.(30));
  const drain = await waitForQueueDrain(page, timeoutMs);
  const blockers = [...drain.blockers, ...teleportCoverageBlockers(drain.counters)];
  return {
    name,
    distanceM: Math.hypot(to[0] - from[0], to[1] - from[1]),
    from,
    to,
    timeToGameplayReadyMs: readiness.timeToGameplayReadyMs,
    readinessPolls: readiness.readinessPolls,
    passed: blockers.length === 0,
    blockers,
    counters: drain.counters,
  };
}

async function runTeleportDrills(page: Page, timeoutMs: number): Promise<TeleportEvidence[]> {
  const results: TeleportEvidence[] = [];
  results.push(await gameplayTeleport(page, "2km", [0, 0], [2_000, 0], timeoutMs));
  results.push(await gameplayTeleport(page, "8km", [2_000, 0], [-6_000, 0], timeoutMs));
  await gameplayTeleport(page, "2km", [-6_000, 0], [-8_000, 0], timeoutMs);
  results.push(await gameplayTeleport(page, "rim-to-rim", [-8_000, 0], [8_000, 0], timeoutMs));
  return results;
}

async function runDeviceLossBaseline(page: Page, timeoutMs: number): Promise<DeviceLossEvidence> {
  const before = await page.evaluate(async () => {
    const hooks = window.__drusnielClod;
    const pose = hooks?.getPose?.();
    if (!pose || !hooks?.runTerrainEditProbe || !hooks.flushSaveRuntime || !hooks.getPlayableSliceSnapshot) {
      throw new Error("device-loss baseline requires pose, terrain-edit, save-flush, and playable-snapshot hooks");
    }
    const edit = await hooks.runTerrainEditProbe({
      origin: [pose.p[0], pose.p[1] + 128, pose.p[2]],
      direction: [0, -1, 0],
    });
    await hooks.flushSaveRuntime();
    return { edit, snapshot: hooks.getPlayableSliceSnapshot() };
  });
  await page.evaluate(() => {
    const destroy = window.__drusnielClod?.destroyRendererDevice;
    if (!destroy) throw new Error("device-loss baseline requires destroyRendererDevice");
    destroy();
  });
  await page.waitForFunction(
    () => window.__drusnielClod?.error?.includes("WebGPU device lost") === true
      && typeof window.__drusnielClod?.recoverAfterDeviceLoss === "function",
    undefined,
    { timeout: timeoutMs, polling: 100 },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.evaluate(() => { void window.__drusnielClod?.recoverAfterDeviceLoss?.(); }).catch(() => undefined);
  await navigation;
  await waitReady(page, timeoutMs);
  await page.evaluate(() => window.__drusnielClod?.settle?.(120));
  const after = await page.evaluate(() => window.__drusnielClod?.getPlayableSliceSnapshot?.() ?? null);
  const failures: string[] = [];
  if (!after) failures.push("playable snapshot unavailable after controlled reload");
  if (after && after.terrain.voxelDeltaCount < before.snapshot.terrain.voxelDeltaCount) {
    failures.push(`voxel deltas regressed across reload: ${after.terrain.voxelDeltaCount} < ${before.snapshot.terrain.voxelDeltaCount}`);
  }
  if (after && after.persistence.lastError !== 0) failures.push(`save_last_error=${after.persistence.lastError} after reload`);
  return {
    requested: true,
    error,
    editRevision: before.edit.editRevision,
    voxelDeltaCountBefore: before.snapshot.terrain.voxelDeltaCount,
    voxelDeltaCountAfter: after?.terrain.voxelDeltaCount ?? null,
    persistenceErrorAfter: after?.persistence.lastError ?? null,
    controlledReloadInstalled: error?.includes("WebGPU device lost") === true,
    passed: failures.length === 0,
    failures,
  };
}

function recoveryFailures(recovery: readonly RecoveryEvidence[], thresholds: SoakThresholds | null): string[] {
  if (!thresholds) return [];
  return recovery.flatMap((entry) => {
    if (!entry.passed) return [`${entry.name} did not recover: ${entry.blockers.join(", ")}`];
    if (entry.recoveryMs > thresholds.maxBackgroundRecoveryMs) return [`${entry.name} recovery ${entry.recoveryMs.toFixed(0)}ms > ${thresholds.maxBackgroundRecoveryMs}ms`];
    return [];
  });
}

function teleportFailures(teleports: readonly TeleportEvidence[], thresholds: SoakThresholds | null): string[] {
  if (!thresholds) return [];
  return teleports.flatMap((entry) => {
    const failures = entry.blockers.map((blocker) => `${entry.name} teleport: ${blocker}`);
    if (entry.timeToGameplayReadyMs > thresholds.maxTeleportRecoveryMs) {
      failures.push(`${entry.name} teleport readiness ${entry.timeToGameplayReadyMs.toFixed(0)}ms > ${thresholds.maxTeleportRecoveryMs}ms`);
    }
    return failures;
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
  const deviceLossRequested = args["device-loss"] === true;
  const thresholds = existsSync(thresholdsPath)
    ? JSON.parse(readFileSync(thresholdsPath, "utf8")) as SoakThresholds
    : null;
  if (!thresholds && !calibrate) throw new Error(`soak thresholds are missing at ${thresholdsPath}; run with --calibrate to capture baseline evidence`);
  mkdirSync(outDir, { recursive: true });
  const { browser, recipe } = await launchWebGPU();
  const browserVersion = browser.version();
  let samples: SoakMinuteSample[] = [];
  let recovery: RecoveryEvidence[] = [];
  let teleports: TeleportEvidence[] = [];
  let deviceLoss: DeviceLossEvidence = {
    requested: false, error: null, editRevision: null, voxelDeltaCountBefore: null,
    voxelDeltaCountAfter: null, persistenceErrorAfter: null,
    controlledReloadInstalled: false, passed: true, failures: [],
  };
  let runUrl = "";
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const collectGarbage = async () => { await cdp.send("HeapProfiler.collectGarbage"); };
    // Start on the known-ready center. Rim readiness belongs to the teleport drill,
    // not to startup, so a failed rim recovery is attributed to the measured leg.
    const start: readonly [number, number, number] = [0, 96, 0];
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
    await page.waitForFunction(
      () => Object.hasOwn(window.__drusnielClod?.stats?.counters ?? {}, "time_to_gameplay_ready_ms"),
      undefined,
      { timeout: timeoutMs, polling: 250 },
    );
    await page.evaluate(() => window.__drusnielClod?.settle?.(600));
    await page.evaluate(() => window.__drusnielClod?.beginMovementRouteProbe?.());
    samples = await runWander(page, minutes, collectGarbage);
    recovery = [
      await backgroundForeground(page, timeoutMs, backgroundSeconds),
    ];
    teleports = await runTeleportDrills(page, timeoutMs);
    if (deviceLossRequested) deviceLoss = await runDeviceLossBaseline(page, timeoutMs);
  } finally {
    await browser.close();
  }
  // The --minutes 0 recovery drill exercises background/foreground recovery only;
  // soak envelopes need a wander window and would fail closed on an empty one.
  const evaluation: SoakEvaluation | null = thresholds && minutes > 0 ? evaluateSoak(samples, thresholds) : null;
  const failures = [
    ...(evaluation?.failures ?? []),
    ...recoveryFailures(recovery, thresholds),
    ...teleportFailures(teleports, thresholds),
    ...deviceLoss.failures.map((failure) => `device loss: ${failure}`),
  ];
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
      contract: "playable-world P1 teleportTargetReady + time_to_gameplay_ready_ms",
      evidence: teleports,
    },
    deviceLoss,
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
