// Deterministic infinite-islands movement benchmark.
//
// Loads the scene, waits for streaming convergence, then measures two windows with the
// in-page perf probe (`window.__drusnielPerf`):
//   1. static  — camera at the spawn pose, N settled frames.
//   2. moving  — an in-page rAF driver advances the pose a fixed distance per rendered
//                frame along a deterministic multi-segment route (playable traversal),
//                so terrain/vegetation streaming is exercised while frames are sampled.
// After measurement it revisits fixed route checkpoints and captures converged
// screenshots for visual-parity comparison between runs.
//
// Usage (dev server must be running; never through rtk):
//   npm --prefix tools/clod-poc run perf:move -- --out perf-runs/move-baseline
//   npm --prefix tools/clod-poc run perf:move -- --speed 0.25 --moveFrames 900 --shots 0

import { execSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, CDPSession, Page } from "playwright";
import { launchWebGPU } from "./launch.js";
import { inspectPngSanity, type ImageSanityResult } from "./infinite_acceptance/image_sanity.js";
import {
  convergenceTimeoutBlockers,
  evaluateConvergence,
  profileAcceptanceParams,
  type ConvergenceSnapshot,
} from "./infinite_acceptance/convergence.js";

type Args = Record<string, string | boolean>;
type PoseTuple = [number, number, number];
interface CamPose { p: PoseTuple; yaw: number; pitch: number; fov?: number }

const READY_TIMEOUT_MS = 360_000;
const CONVERGENCE_TIMEOUT_MS = 360_000;
const CONVERGENCE_POLL_MS = 500;
const CONVERGENCE_STABLE_POLLS = 3;
const CHECKPOINT_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
const CHECKPOINT_SETTLE_FRAMES = 45;
const CHECKPOINT_CONVERGE_TIMEOUT_MS = 45_000;
const SPAWN_X = 2048;
const SPAWN_Z = 2048;
const SPAWN_YAW = 2.65;

/** Route as direction fractions of the total distance; du/dv are unit-ish directions. */
const ROUTE_SEGMENTS = [
  { label: "east", dux: 1, duz: 0, fraction: 0.35 },
  { label: "south-east", dux: Math.SQRT1_2, duz: Math.SQRT1_2, fraction: 0.25 },
  { label: "east-b", dux: 1, duz: 0, fraction: 0.25 },
  { label: "north", dux: 0, duz: -1, fraction: 0.15 },
] as const;

const PHASE_KEYS = [
  "frameMs",
  "selectionMs",
  "selectionUpdateMs",
  "clodApplyMs",
  "terrainPhaseMs",
  "bubbleMs",
  "farSummaryMs",
  "farSumTilesMs",
  "farSumNaadfMs",
  "farSumShellMs",
  "farSumClipmapMs",
  "farSumShellMoveMs",
  "farSumShadowProxyMs",
  "farSumBiomeStreamMs",
  "farSumSunLightMs",
  "canopyMs",
  "shadowProxyMs",
  "clodShadowMs",
  "vegetationTotalMs",
  "grassMs",
  "treesMs",
  "understoryMs",
  "forestLightingMs",
  "stonesMs",
  "waterMs",
  "deepOceanMs",
  "weatherMs",
  "propsMs",
  "propsRestMs",
  "statsSyncMs",
  "longViewDiagnosticsMs",
  "renderMs",
  "otherMs",
  "unattributedMs",
  "selectionCutMs",
  "selectionBookMs",
  "selectionSub.views",
  "selectionSub.apply",
  "selectionSub.markActive",
  "selectionSub.prefetch",
  "selectionSub.dispatch",
  "selectionSub.compute",
  "selectionSub.readback",
  "selectionSub.parity",
  "selectionSub.cache",
  "selectionSub.hash",
  "selectionSub.commit",
] as const;

const WORST_FRAME_COUNT = 12;

/** Full numeric field dump of the slowest frames by `key`, for spike forensics.
 *  Independent per-phase percentiles cannot be added; these rows show what actually
 *  co-occurred inside the same bad frame. */
function worstFramesBy(
  samples: readonly Record<string, unknown>[],
  key: string,
  count = WORST_FRAME_COUNT,
): Record<string, number>[] {
  return [...samples]
    .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
    .slice(0, count)
    .map((sample) => {
      const out: Record<string, number> = {};
      for (const [fieldKey, value] of Object.entries(sample)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && (numeric !== 0 || fieldKey === "frameId")) out[fieldKey] = numeric;
      }
      return out;
    });
}

/** Repo identity so runs are comparable: SHA + dirty flag. Never trust silent failure —
 *  report "unknown" explicitly when git is unavailable. */
function gitIdentity(): { sha: string; dirty: boolean | null } {
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    return { sha, dirty: status.length > 0 };
  } catch {
    return { sha: "unknown", dirty: null };
  }
}

/** When benchmarking a frozen `vite preview` build, the SOURCE SHA at run time can be
 *  newer than what dist serves; the dist mtime disambiguates which build was measured. */
function distBuiltAt(): string | null {
  try {
    return statSync("dist/index.html").mtime.toISOString();
  } catch {
    return null;
  }
}

const COUNTER_KEYS = [
  "renderedCount",
  "terrainTriangles",
  "chunkGroupsBuilt",
  "nearFieldChunkGroups",
] as const;

const STREAMING_DELTA_COUNTERS = [
  "live_bubble_built_total",
  "live_bubble_evictions_total",
  "live_clod_stream_apply_pages_total",
  "live_clod_stream_evictions_total",
  "live_clod_stream_stale_discards_total",
] as const;

interface PhaseStats { avg: number; p50: number; p95: number; p99: number; max: number }
interface WindowSummary {
  frames: number;
  fpsAvg: number;
  fpsP5: number;
  phases: Record<string, PhaseStats>;
  counters: Record<string, number>;
}

interface CheckpointResult {
  label: string;
  fraction: number;
  pose: PoseTuple;
  png: string;
  sanity: ImageSanityResult;
  converged: boolean;
}

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

function num(value: string | boolean | undefined, fallback: number): number {
  const parsed = Number(str(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
}

function phaseStats(values: readonly number[]): PhaseStats {
  if (values.length === 0) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    avg,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function summarizeWindow(samples: readonly Record<string, unknown>[]): WindowSummary {
  const phases: Record<string, PhaseStats> = {};
  for (const key of PHASE_KEYS) {
    phases[key] = phaseStats(samples.map((s) => Number(s[key]) || 0));
  }
  const counters: Record<string, number> = {};
  for (const key of COUNTER_KEYS) {
    const values = samples.map((s) => Number(s[key]) || 0);
    counters[`${key}Avg`] = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
    counters[`${key}Max`] = values.length > 0 ? Math.max(...values) : 0;
  }
  const frameMs = samples.map((s) => Number(s["frameMs"]) || 0).filter((v) => v > 0);
  const fps = frameMs.map((v) => 1000 / v).sort((a, b) => a - b);
  return {
    frames: samples.length,
    fpsAvg: fps.length > 0 ? fps.reduce((sum, v) => sum + v, 0) / fps.length : 0,
    fpsP5: percentile(fps, 0.05),
    phases,
    counters,
  };
}

function buildParams(args: Args): Record<string, string> {
  const world = str(args["world"]) ?? "16";
  const seed = str(args["seed"]) ?? "1";
  const moveFrames = num(args["moveFrames"], 900);
  const staticFrames = num(args["staticFrames"], 300);
  const profile = str(args["profile"]) ?? "acceptance";

  const params: Record<string, string> = {};
  if (profile === "acceptance") {
    Object.assign(params, profileAcceptanceParams("full"));
    // Full-quality measurement: acceptance's reduced render scale would hide GPU cost.
    delete params["renderScale"];
    delete params["render_scale"];
    delete params["dprCap"];
    delete params["dpr_cap"];
  }
  // Perf probe window is controlled manually via reset(); make the sample buffer big
  // enough that it never saturates inside a measurement window.
  params["perfProbe"] = "1";
  params["perfWarmupFrames"] = "0";
  params["perfSampleFrames"] = String(Math.max(moveFrames, staticFrames) * 4);
  delete params["perfProbeConvergenceGate"];

  params["scene"] = "infinite-islands";
  params["world"] = world;
  params["seed"] = seed;
  params["webgpuSelection"] = "1";
  params["farShell"] = "1";
  params["x"] = String(SPAWN_X);
  params["z"] = String(SPAWN_Z);
  params["yaw"] = String(SPAWN_YAW);
  const renderScale = str(args["renderScale"]);
  if (renderScale) {
    params["renderScale"] = renderScale;
    params["dprCap"] = "1";
  }
  const viewPrewarmCompile = str(args["viewPrewarmCompile"]);
  if (viewPrewarmCompile) params["viewPrewarmCompile"] = viewPrewarmCompile;
  const sceneCompileWarm = str(args["sceneCompileWarm"]);
  if (sceneCompileWarm) params["sceneCompileWarm"] = sceneCompileWarm;
  return params;
}

function buildUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function waitForReady(page: Page): Promise<void> {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const state = await page.evaluate(() => {
      const clod = window.__drusnielClod;
      return { ready: clod?.ready ?? false, error: clod?.error ?? null, msg: clod?.progressMsg ?? null };
    });
    if (state.error) throw new Error(`app fatal error: ${state.error}`);
    if (state.ready) return;
    if (Date.now() - lastLog >= 5000) {
      lastLog = Date.now();
      console.log(`[perf-move] waiting for ready (${state.msg ?? "no progress"})`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`app not ready after ${READY_TIMEOUT_MS}ms`);
}

async function readConvergenceSnapshot(page: Page): Promise<ConvergenceSnapshot> {
  return await page.evaluate(() => {
    const counters = window.__drusnielClod?.stats?.counters ?? {};
    return {
      tilesMissing: counters["far_summary_tiles_missing"] ?? -1,
      tilesBuilding: counters["far_summary_tiles_building"] ?? -1,
      farShellRebuildPending: counters["far_shell_rebuild_pending"] ?? 0,
      textureWindowPending: counters["terrain_texture_window_pending"] ?? 0,
      bubbleBuilding: counters["live_bubble_building_pages"] ?? -1,
      bubbleReady: counters["live_bubble_ready_pages"] ?? -1,
      bubbleRequired: counters["live_bubble_required_pages"] ?? -1,
      bubbleFailed: counters["live_bubble_failed_pages"] ?? -1,
      bubbleRetryPages: counters["live_bubble_gpu_retry_pages"] ?? 0,
      bubblePendingChunks: counters["live_bubble_pending_chunks"] ?? 0,
      bubbleInflightChunks: counters["live_bubble_inflight_chunks"] ?? 0,
      streamRequired: counters["live_clod_stream_required_pages"] ?? 0,
      streamBudget: counters["live_clod_stream_build_budget"] ?? 0,
      streamPending: counters["live_clod_stream_pending_pages"] ?? 0,
      streamInflight: counters["live_clod_stream_inflight_batches"] ?? 0,
      streamReady: counters["live_clod_stream_ready_pages"] ?? 0,
      streamCached: counters["live_clod_stream_cached_pages"] ?? 0,
      streamFailed: counters["live_clod_stream_failed_pages"] ?? 0,
      streamMaxCached: counters["live_clod_stream_max_cached_pages"] ?? 0,
      streamSafetyCacheCapacityOk: counters["live_clod_stream_safety_cache_capacity_ok"] ?? 1,
      streamSafetyRequired: counters["live_clod_stream_safety_required_pages"] ?? 0,
      streamSafetyReady: counters["live_clod_stream_safety_ready_pages"] ?? 0,
      streamSafetyPending: counters["live_clod_stream_safety_pending_pages"] ?? 0,
      streamSafetyInflight: counters["live_clod_stream_safety_inflight_pages"] ?? 0,
      streamRefinementPending: counters["live_clod_stream_refinement_pending_pages"] ?? 0,
      streamRefinementInflight: counters["live_clod_stream_refinement_inflight_pages"] ?? 0,
      streamParentCoverageViolations: counters["live_clod_stream_parent_coverage_violations"] ?? 0,
      streamActiveRootPages: counters["live_clod_stream_active_root_pages"] ?? 0,
      proxyBuilding: counters["shadow_proxy_building"] ?? -1,
    } as const;
  }) as ConvergenceSnapshot;
}

async function waitForConvergence(page: Page, label: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  let stablePolls = 0;
  let last: ConvergenceSnapshot | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await readConvergenceSnapshot(page);
    last = snapshot;
    const { quiet } = evaluateConvergence(snapshot);
    stablePolls = quiet ? stablePolls + 1 : 0;
    if (stablePolls >= CONVERGENCE_STABLE_POLLS) {
      console.log(`[perf-move] ${label}: converged after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      return true;
    }
    await page.waitForTimeout(CONVERGENCE_POLL_MS);
  }
  const blockers = last ? convergenceTimeoutBlockers(last) : [];
  console.log(`[perf-move] ${label}: convergence timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
  if (blockers.length > 0) console.log(`[perf-move] ${label}: blockers:\n${blockers.join("\n")}`);
  return false;
}

/** Waits for N rendered frames using the app's own settle hook. In-page code is passed
 *  as a string: tsx/esbuild injects `__name` helpers into serialized function callbacks,
 *  which do not exist in the page and trip the app's fail-loud unhandled-rejection hook. */
async function settleFrames(page: Page, frames: number, timeoutMs: number): Promise<void> {
  const settled = page.evaluate(
    `(function(){` +
    `var clod = window.__drusnielClod;` +
    `if (clod && typeof clod.settle === "function") return clod.settle(${Math.max(1, Math.floor(frames))});` +
    `return new Promise(function(resolve){` +
    `var remaining = ${Math.max(1, Math.floor(frames))};` +
    `window.requestAnimationFrame(function tick(){ remaining -= 1; if (remaining <= 0) resolve(); else window.requestAnimationFrame(tick); });` +
    `});` +
    `})()`,
  );
  await Promise.race([
    settled,
    page.waitForTimeout(timeoutMs).then(() => {
      throw new Error(`timed out waiting for ${frames} rendered frame(s)`);
    }),
  ]);
  const appError = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (appError) throw new Error(`app reported fatal error after settle(${frames}): ${appError}`);
}

async function resetPerfProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perf = window.__drusnielPerf;
    if (!perf?.reset) throw new Error("perf probe missing; pass perfProbe=1");
    perf.reset();
  });
}

async function readPerfSamples(page: Page): Promise<Record<string, unknown>[]> {
  return await page.evaluate(() => {
    const perf = window.__drusnielPerf;
    if (!perf) throw new Error("perf probe missing");
    return JSON.parse(JSON.stringify(perf.samples ?? [])) as Record<string, unknown>[];
  });
}

async function readCounters(page: Page, keys: readonly string[]): Promise<Record<string, number>> {
  return await page.evaluate((wanted) => {
    const counters = window.__drusnielClod?.stats?.counters ?? {};
    const out: Record<string, number> = {};
    for (const key of wanted) out[key] = Number(counters[key]) || 0;
    return out;
  }, keys as string[]);
}

async function readPose(page: Page): Promise<CamPose> {
  return await page.evaluate(() => {
    const pose = window.__drusnielClod?.getPose?.();
    if (!pose) throw new Error("getPose hook missing");
    return JSON.parse(JSON.stringify(pose)) as { p: [number, number, number]; yaw: number; pitch: number; fov?: number };
  });
}

async function setPose(page: Page, pose: CamPose): Promise<void> {
  await page.evaluate((next) => {
    const hook = window.__drusnielClod?.setPose;
    if (typeof hook !== "function") throw new Error("setPose hook missing");
    hook(next);
  }, pose);
}

interface RouteSegmentSpec { label: string; dux: number; duz: number; lengthM: number }

function routeSegments(totalDistanceM: number): RouteSegmentSpec[] {
  return ROUTE_SEGMENTS.map((segment) => ({
    label: segment.label,
    dux: segment.dux,
    duz: segment.duz,
    lengthM: totalDistanceM * segment.fraction,
  }));
}

function routePoint(start: CamPose, segments: readonly RouteSegmentSpec[], fraction: number): CamPose {
  const total = segments.reduce((sum, s) => sum + s.lengthM, 0);
  let remaining = total * Math.min(1, Math.max(0, fraction));
  let x = start.p[0];
  let z = start.p[2];
  let yaw = start.yaw;
  for (const segment of segments) {
    const take = Math.min(remaining, segment.lengthM);
    x += segment.dux * take;
    z += segment.duz * take;
    remaining -= take;
    yaw = Math.atan2(-segment.dux, -segment.duz);
    if (remaining <= 0) break;
  }
  return { p: [x, start.p[1], z], yaw, pitch: start.pitch, fov: start.fov };
}

async function startMoveDriver(page: Page, speedMPerFrame: number, segments: readonly RouteSegmentSpec[]): Promise<void> {
  // String-form evaluate: see settleFrames for why serialized callbacks are unsafe here.
  const driverSource =
    `(function(){` +
    `var speed = ${JSON.stringify(speedMPerFrame)};` +
    `var route = ${JSON.stringify(segments)};` +
    `var clod = window.__drusnielClod;` +
    `if (!clod || typeof clod.setPose !== "function" || typeof clod.getPose !== "function") throw new Error("pose hooks missing");` +
    `var start = clod.getPose();` +
    `var pose = { p: [start.p[0], start.p[1], start.p[2]], yaw: start.yaw, pitch: start.pitch, fov: start.fov };` +
    `var driver = { active: true, frames: 0, distanceM: 0, error: null };` +
    `var segmentIndex = 0;` +
    `var segmentTravelled = 0;` +
    `window.__drusnielMoveDriver = driver;` +
    `window.requestAnimationFrame(function step(){` +
    `if (!driver.active) return;` +
    `try {` +
    `var segment = route[segmentIndex];` +
    `if (!segment) { driver.active = false; return; }` +
    `pose.p[0] += segment.dux * speed;` +
    `pose.p[2] += segment.duz * speed;` +
    `pose.yaw = Math.atan2(-segment.dux, -segment.duz);` +
    `segmentTravelled += speed;` +
    `driver.distanceM += speed;` +
    `driver.frames += 1;` +
    `if (segmentTravelled >= segment.lengthM) { segmentIndex += 1; segmentTravelled = 0; }` +
    `clod.setPose(pose);` +
    `} catch (error) { driver.error = error && error.message ? error.message : String(error); driver.active = false; return; }` +
    `window.requestAnimationFrame(step);` +
    `});` +
    `})()`;
  await page.evaluate(driverSource);
}

async function readMoveDriver(page: Page): Promise<{ active: boolean; frames: number; distanceM: number; error: string | null }> {
  return await page.evaluate(() => {
    const driver = (window as typeof window & { __drusnielMoveDriver?: { active: boolean; frames: number; distanceM: number; error: string | null } }).__drusnielMoveDriver;
    if (!driver) throw new Error("move driver missing");
    return { active: driver.active, frames: driver.frames, distanceM: driver.distanceM, error: driver.error };
  });
}

async function stopMoveDriver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const driver = (window as typeof window & { __drusnielMoveDriver?: { active: boolean } }).__drusnielMoveDriver;
    if (driver) driver.active = false;
  });
}

function fmt(value: number): string {
  return value.toFixed(2);
}

/** V8 sampling profiler over a measurement window (--cpuprofile). The resulting
 *  .cpuprofile (loadable in Chrome DevTools > Performance) attributes long render
 *  frames to GC, JS self time, or idle — the render spikes survived two pipeline
 *  precompile hypotheses, so classification must come from a profile, not guesses. */
async function startCpuProfile(page: Page): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 200 });
  await session.send("Profiler.start");
  return session;
}

async function stopCpuProfile(session: CDPSession, outPath: string): Promise<void> {
  const { profile } = await session.send("Profiler.stop") as { profile: unknown };
  writeFileSync(outPath, JSON.stringify(profile));
  await session.detach().catch(() => undefined);
}

/** Phase stats flattened into QA `areas` maps (area.field addressing, see qaTypes.ts). */
function qaAreasFromWindow(summary: WindowSummary): Record<string, Record<string, number>> {
  const p95: Record<string, number> = {};
  const max: Record<string, number> = {};
  const avg: Record<string, number> = {};
  for (const [key, stats] of Object.entries(summary.phases)) {
    p95[key] = Number(stats.p95.toFixed(3));
    max[key] = Number(stats.max.toFixed(3));
    avg[key] = Number(stats.avg.toFixed(3));
  }
  return {
    phases_p95: p95,
    phases_max: max,
    phases_avg: avg,
    counters: { ...summary.counters, fps_avg: Number(summary.fpsAvg.toFixed(2)), fps_p5: Number(summary.fpsP5.toFixed(2)) },
  };
}

/** Checkpoint screenshots in QA summary form; sanity lumas are 0..255, QA probes expect 0..1. */
function qaScreenshots(checkpoints: readonly CheckpointResult[]): {
  id: string;
  name: string;
  path: string;
  metrics: { luminance_mean: number; luminance_stddev: number };
}[] {
  return checkpoints.map((cp) => ({
    id: cp.label,
    name: `${cp.label}.png`,
    path: cp.png.replaceAll("\\", "/"),
    metrics: {
      luminance_mean: Number((cp.sanity.meanLuma / 255).toFixed(4)),
      luminance_stddev: Number((cp.sanity.rgbStddev / 255).toFixed(4)),
    },
  }));
}

function windowMarkdown(name: string, summary: WindowSummary): string[] {
  const lines = [
    `## ${name}`,
    "",
    `frames: ${summary.frames} — fps avg **${summary.fpsAvg.toFixed(1)}**, fps p5 (slowest 5%) **${summary.fpsP5.toFixed(1)}**`,
    "",
    "| phase | avg | p50 | p95 | p99 | max |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const key of PHASE_KEYS) {
    const stats = summary.phases[key];
    if (!stats || (stats.max === 0 && stats.avg === 0)) continue;
    lines.push(`| ${key} | ${fmt(stats.avg)} | ${fmt(stats.p50)} | ${fmt(stats.p95)} | ${fmt(stats.p99)} | ${fmt(stats.max)} |`);
  }
  lines.push("");
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = str(args["baseUrl"]) ?? process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5180/";
  process.env["CLOD_POC_BASE_URL"] = baseUrl;
  const staticFrames = num(args["staticFrames"], 300);
  const moveFrames = num(args["moveFrames"], 900);
  const speed = num(args["speed"], 0.25);
  const takeShots = str(args["shots"]) !== "0";
  const outDir = resolve(str(args["out"]) ?? join("perf-runs", `move-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  mkdirSync(outDir, { recursive: true });

  const params = buildParams(args);
  const url = buildUrl(baseUrl, params);
  console.log(`[perf-move] url: ${url}`);
  console.log(`[perf-move] static ${staticFrames}f, moving ${moveFrames}f @ ${speed} m/frame (${(moveFrames * speed).toFixed(0)}m route)`);

  const { browser, recipe } = await launchWebGPU();
  const warnings: string[] = [];
  const errors: string[] = [];
  let page: Page | null = null;
  try {
    page = await (browser as Browser).newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForReady(page);
    const startupConverged = await waitForConvergence(page, "startup", CONVERGENCE_TIMEOUT_MS);

    // --- static window ---
    await resetPerfProbe(page);
    await settleFrames(page, staticFrames, Math.max(120_000, staticFrames * 200));
    const staticSamples = await readPerfSamples(page);
    const staticSummary = summarizeWindow(staticSamples);
    console.log(`[perf-move] static: ${staticSamples.length} samples, frame p50 ${fmt(staticSummary.phases["frameMs"]!.p50)}ms p95 ${fmt(staticSummary.phases["frameMs"]!.p95)}ms`);

    // --- moving window ---
    const startPose = await readPose(page);
    const segments = routeSegments(moveFrames * speed);
    const countersBefore = await readCounters(page, STREAMING_DELTA_COUNTERS);
    await resetPerfProbe(page);
    const profileSession = args["cpuprofile"] !== undefined && args["cpuprofile"] !== "0"
      ? await startCpuProfile(page)
      : null;
    await startMoveDriver(page, speed, segments);
    let driver = await readMoveDriver(page);
    const moveDeadline = Date.now() + Math.max(180_000, moveFrames * 300);
    while (driver.active && Date.now() < moveDeadline) {
      await settleFrames(page, 60, 60_000);
      driver = await readMoveDriver(page);
    }
    await stopMoveDriver(page);
    if (profileSession) {
      await stopCpuProfile(profileSession, join(outDir, "moving.cpuprofile"));
      console.log(`[perf-move] wrote ${join(outDir, "moving.cpuprofile")}`);
    }
    if (driver.error) throw new Error(`move driver failed: ${driver.error}`);
    const movingSamples = await readPerfSamples(page);
    const countersAfter = await readCounters(page, STREAMING_DELTA_COUNTERS);
    const endPose = await readPose(page);
    const movingSummary = summarizeWindow(movingSamples.slice(0, moveFrames));
    const travelledM = Math.hypot(endPose.p[0] - startPose.p[0], endPose.p[2] - startPose.p[2]);
    const streamingDeltas: Record<string, number> = {};
    for (const key of STREAMING_DELTA_COUNTERS) {
      streamingDeltas[key] = (countersAfter[key] ?? 0) - (countersBefore[key] ?? 0);
    }
    const streamingExercised = (streamingDeltas["live_bubble_built_total"] ?? 0) > 0
      || (streamingDeltas["live_clod_stream_apply_pages_total"] ?? 0) > 0;
    console.log(
      `[perf-move] moving: ${movingSamples.length} samples over ${driver.distanceM.toFixed(0)}m ` +
      `(net ${travelledM.toFixed(0)}m), frame p50 ${fmt(movingSummary.phases["frameMs"]!.p50)}ms ` +
      `p95 ${fmt(movingSummary.phases["frameMs"]!.p95)}ms, streamingExercised=${streamingExercised}`,
    );
    if (!streamingExercised) {
      console.warn("[perf-move] WARNING: no streaming page builds observed during movement — route may not be tracking the streaming center");
    }

    // --- screenshot checkpoints (converged, for visual parity) ---
    const checkpoints: CheckpointResult[] = [];
    if (takeShots) {
      for (const fraction of CHECKPOINT_FRACTIONS) {
        const label = `cp-${Math.round(fraction * 100)}`;
        const pose = routePoint(startPose, segments, fraction);
        await setPose(page, pose);
        await settleFrames(page, CHECKPOINT_SETTLE_FRAMES, 60_000);
        const converged = await waitForConvergence(page, label, CHECKPOINT_CONVERGE_TIMEOUT_MS);
        await settleFrames(page, 10, 30_000);
        const png = join(outDir, `${label}.png`);
        await page.screenshot({ path: png });
        const sanity = await inspectPngSanity(png, { width: 1920, height: 1080 });
        checkpoints.push({ label, fraction, pose: pose.p, png, sanity, converged });
        console.log(`[perf-move] ${label}: shot ${png} (converged=${converged})`);
      }
    }

    const git = gitIdentity();
    const summary = {
      schemaVersion: 2,
      startedAt: new Date().toISOString(),
      gitSha: git.sha,
      gitDirty: git.dirty,
      distBuiltAt: distBuiltAt(),
      viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
      baseUrl,
      url,
      launchRecipe: recipe,
      params,
      route: { speedMPerFrame: speed, moveFrames, segments, startPose, endPose, travelledM, driverDistanceM: driver.distanceM },
      startupConverged,
      static: staticSummary,
      moving: movingSummary,
      staticWorstFrames: worstFramesBy(staticSamples, "frameMs"),
      movingWorstFrames: worstFramesBy(movingSamples, "frameMs"),
      movingWorstByRender: worstFramesBy(movingSamples, "renderMs"),
      movingWorstByViews: worstFramesBy(movingSamples, "selectionSub.views"),
      streamingDeltas,
      streamingExercised,
      checkpoints: checkpoints.map((cp) => ({ ...cp, png: cp.png.replaceAll("\\", "/") })),
      staticSampleCount: staticSamples.length,
      movingSampleCount: movingSamples.length,
      warnings: warnings.slice(0, 50),
      errors: errors.slice(0, 50),
    };
    writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

    // QA-framework summary (WebQaSummary shape, see src/qa/qaTypes.ts). Evaluate with:
    //   npm run qa -- --config config/qa_perf_move.yaml --summary <outDir>/qa-summary.json
    // cp-0 sits at the route start (the static pose), so it doubles as the static
    // checkpoint's screenshot; the moving checkpoint carries the full route set.
    const shots = qaScreenshots(checkpoints);
    const qaSummary = {
      scene: "infinite-islands-move",
      run_started_utc: summary.startedAt,
      checkpoints: [
        {
          name: "static",
          median_frame_ms: staticSummary.phases["frameMs"]!.p50,
          p95_frame_ms: staticSummary.phases["frameMs"]!.p95,
          p99_frame_ms: staticSummary.phases["frameMs"]!.p99,
          areas: qaAreasFromWindow(staticSummary),
          screenshots: shots.filter((shot) => shot.id === "cp-0"),
        },
        {
          name: "moving",
          median_frame_ms: movingSummary.phases["frameMs"]!.p50,
          p95_frame_ms: movingSummary.phases["frameMs"]!.p95,
          p99_frame_ms: movingSummary.phases["frameMs"]!.p99,
          areas: {
            ...qaAreasFromWindow(movingSummary),
            streaming: {
              ...streamingDeltas,
              exercised: streamingExercised ? 1 : 0,
              startup_converged: startupConverged ? 1 : 0,
            },
          },
          screenshots: shots,
        },
      ],
    };
    writeFileSync(join(outDir, "qa-summary.json"), JSON.stringify(qaSummary, null, 2));

    const md = [
      "# clod-poc infinite-islands movement perf",
      "",
      `git: ${git.sha.slice(0, 10)}${git.dirty === null ? " (dirty state unknown)" : git.dirty ? " (dirty tree)" : ""}`,
      `route: ${(moveFrames * speed).toFixed(0)}m at ${speed} m/frame over ${moveFrames} frames — streaming exercised: **${streamingExercised}** ` +
      `(bubble +${streamingDeltas["live_bubble_built_total"]}, stream +${streamingDeltas["live_clod_stream_apply_pages_total"]})`,
      `startup converged: ${startupConverged}`,
      "",
      ...windowMarkdown("static (post-convergence)", staticSummary),
      ...windowMarkdown("moving (traversal)", movingSummary),
      "## checkpoints",
      "",
      ...checkpoints.map((cp) => `- ${cp.label} @ (${cp.pose[0].toFixed(0)}, ${cp.pose[2].toFixed(0)}): ${cp.png} converged=${cp.converged} sanity=${cp.sanity.passed ? "pass" : cp.sanity.failures.join("; ")} luma=${cp.sanity.meanLuma.toFixed(1)}`),
      "",
      `warnings: ${warnings.length}, errors: ${errors.length}`,
      "",
    ];
    writeFileSync(join(outDir, "summary.md"), md.join("\n"));
    console.log(`[perf-move] wrote ${join(outDir, "summary.json")}`);
  } finally {
    await page?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error("[perf-move] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
