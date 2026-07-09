import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import sharp from "sharp";
import type { Browser, ConsoleMessage, Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";
import { inspectPngSanity, type ImageSanityResult } from "./infinite_acceptance/image_sanity.js";
import { aggregatePassed, renderMarkdownReport, type SceneReportInput } from "./infinite_acceptance/report.js";
import { buildInfiniteQaSummary } from "./infinite_acceptance/qa_summary.js";
import { settlePage } from "./infinite_acceptance/page_settle.js";
import {
  cacheEvidenceFromTimings,
  convergenceTimeoutBlockers,
  evaluateConvergence,
  profileAcceptanceParams,
  type AcceptanceProfile,
  type AcceptanceSceneCacheEvidence,
  type ConvergenceSnapshot,
} from "./infinite_acceptance/convergence.js";
import {
  COVERAGE_REQUIRED_COUNTERS,
  COVERAGE_RULES,
  evaluateThresholds,
  extractAcceptanceCounters,
  PERF_REQUIRED_COUNTERS,
  PERF_RULES,
  REQUIRED_COUNTERS,
  THRESHOLD_RULES,
  type RequiredCounter,
  type ThresholdEvaluation,
  type ThresholdRule,
} from "./infinite_acceptance/thresholds.js";

process.env["CLOD_POC_BASE_URL"] ??= "http://127.0.0.1:5173/";

const WIDTH = 1920;
const HEIGHT = 1080;
const READY_TIMEOUT_MS = 360_000;
const SETTLE_TIMEOUT_MS = 30_000;
const CONSOLE_PRINT_LIMIT = 24;
const PAGE_ERROR_PRINT_LIMIT = 8;
const PAGE_ERROR_STORE_LIMIT = 50;
const WARMUP_FRAMES = 30;
const DEFAULT_SAMPLE_FRAMES = 180;
const FAST_SAMPLE_FRAMES = 60;
const CONVERGENCE_TIMEOUT_MS = 360_000;
const CONVERGENCE_POLL_MS = 500;
const CONVERGENCE_STABLE_POLLS = 3;
const MIN_WALK_ROUTE_DISTANCE_M = 48;
const MOVEMENT_SAMPLE_FRAMES = 30;
const RUN_ROOT = resolve("acceptance-runs/infinite-islands");
const FAST_STARTUP_WORLD = "4";

const OUTSIDE_STARTUP_CAM = "2048,96,2048,2.6500,-0.4300,55";
const OUTSIDE_HORIZON_CAM = "2048,260,4096,2.6500,-0.3000,55";
const OUTSIDE_STARTUP_SPAWN: SceneExtra = {
  x: "2048",
  z: "2048",
  yaw: "2.65",
  liveClodRootBudget: "2",
  liveClodRootMaxCached: "4",
};

const WALK_ROUTE: MovementSegment[] = [
  { label: "east-a", frames: 180, dx: 160, dz: 0 },
  { label: "south-east", frames: 160, dx: 96, dz: 96 },
  { label: "east-b", frames: 120, dx: 128, dz: 0 },
];

const SCENES: SceneSpec[] = [
  {
    name: "phase3-far-summary-gpu-authoritative",
    freeze: true,
    proceduralDebug: "biome",
    cam: OUTSIDE_STARTUP_CAM,
    extra: { farSummaryGpuAuthoritative: "1", farSummaryGpuStrictParity: "0" },
    validation: "far-summary-gpu-authoritative",
  },
  {
    name: "phase4-stones",
    freeze: true,
    proceduralDebug: "biome",
    cam: OUTSIDE_STARTUP_CAM,
    extra: { gpuReadbacks: "acceptance", stoneGpuCounts: "1" },
    validation: "stone-gpu",
  },
  {
    name: "phase6-canopy",
    freeze: true,
    proceduralDebug: "biome",
    cam: OUTSIDE_STARTUP_CAM,
    extra: { canopy: "1", farClipmap: "1", farClipmapMode: "replace", farClipmapShaderDisplacement: "1" },
    validation: "phase6-canopy",
  },
  {
    name: "walk",
    freeze: false,
    proceduralDebug: "biome",
    extra: OUTSIDE_STARTUP_SPAWN,
    summary: true,
    movementRoute: true,
  },
  {
    name: "biome-near",
    freeze: true,
    proceduralDebug: "biome",
    cam: OUTSIDE_STARTUP_CAM,
  },
  {
    name: "biome-horizon",
    freeze: true,
    proceduralDebug: "biome",
    cam: OUTSIDE_HORIZON_CAM,
  },
  {
    name: "final-near",
    freeze: true,
    cam: OUTSIDE_STARTUP_CAM,
  },
  {
    name: "final-horizon",
    freeze: true,
    cam: OUTSIDE_HORIZON_CAM,
  },
];

const GATE_MODES: GateMode[] = [
  {
    name: "coverage",
    ownershipOracle: "1",
    requiredCounters: COVERAGE_REQUIRED_COUNTERS,
    rules: COVERAGE_RULES,
  },
  {
    name: "perf",
    ownershipOracle: "0",
    requiredCounters: PERF_REQUIRED_COUNTERS,
    rules: PERF_RULES,
  },
];

type JsonRecord = Record<string, unknown>;
type SceneExtra = Record<string, string>;
type PoseTuple = [number, number, number];
type CamPose = { p: PoseTuple; yaw: number; pitch: number; fov?: number };
type SceneValidation = "stone-gpu" | "phase6-canopy" | "far-summary-gpu-authoritative";

const REUSE_MODE_CODES: Record<AcceptanceProfile, number> = {
  full: 1,
  fast: 2,
  reuse: 3,
};

interface SceneSpec {
  name: string;
  freeze: boolean;
  proceduralDebug?: string;
  cam?: string;
  extra?: SceneExtra;
  summary?: boolean;
  movementRoute?: boolean;
  validation?: SceneValidation;
}

interface GateMode {
  name: "coverage" | "perf";
  ownershipOracle: "0" | "1";
  requiredCounters: readonly RequiredCounter[];
  rules: readonly ThresholdRule[];
}

interface MovementSnapshot {
  label: string;
  pose: PoseTuple;
  counters: Record<string, number>;
}

interface MovementReport {
  start: PoseTuple;
  end: PoseTuple;
  horizontalDistanceM: number;
  worldCells: number;
  startedOutsideStartupWorld: boolean;
  endedOutsideStartupWorld: boolean;
  maxLiveBubbleReadyPages: number;
  maxLiveBubbleBuiltThisFrame: number;
  liveBubbleBuiltDelta: number;
  maxStreamCachedPages: number;
  maxStreamApplyPagesThisFrame: number;
  streamApplyPagesDelta: number;
  maxStreamEvictions: number;
  maxStreamStaleDiscards: number;
  streamEvictionsDelta: number;
  streamStaleDiscardsDelta: number;
  samples: MovementSnapshot[];
}

interface SceneResult extends SceneReportInput {
  url: string;
  statsPath: string;
  phase0Path: string;
  summaryPath: string | null;
  comparisonPath: string;
  imageSanity: ImageSanityResult;
  movement: MovementReport | null;
  startupTimings: Record<string, number>;
  configuredWorldPages: number;
  startupWorldPages: number;
  cache: AcceptanceSceneCacheEvidence;
  acceptanceCacheKey: JsonRecord | null;
  consoleWarnings: string[];
  consoleErrors: string[];
  pageErrors: string[];
}

interface RunSceneOptions {
  reusePage: boolean;
  firstSceneOnPage: boolean;
}

interface MovementSegment {
  label: string;
  frames: number;
  dx: number;
  dz: number;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}

function parseProfile(argv: readonly string[]): AcceptanceProfile {
  if (argv.includes("--fast")) return "fast";
  if (argv.includes("--reuse")) return "reuse";
  return "full";
}

function cliValues(args: readonly string[], key: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === key) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        i += 1;
      }
    } else if (arg.startsWith(`${key}=`)) {
      const value = arg.slice(key.length + 1);
      if (value.length > 0) values.push(value);
    }
  }
  return values;
}

function acceptanceSceneAlias(name: string): string {
  if (name === "coverage/phase3-far-summary-gpu-authoritative") return "phase3-far-summary-gpu-authoritative";
  if (name === "coverage/phase4-stones") return "phase4-stones";
  if (name === "coverage/phase6-canopy") return "phase6-canopy";
  return name;
}

function filterActiveScenes(scenes: readonly SceneSpec[], args: readonly string[]): SceneSpec[] {
  const requested = cliValues(args, "--scene")
    .flatMap((value) => value.split(","))
    .map((value) => acceptanceSceneAlias(value.trim()))
    .filter(Boolean);
  if (requested.length === 0) return [...scenes];
  const known = new Set(SCENES.map((scene) => scene.name));
  const unknown = requested.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown --scene value(s): ${unknown.join(", ")}. Valid scenes: ${[...known].join(", ")}`);
  }
  const requestedSet = new Set(requested);
  return scenes.filter((scene) => requestedSet.has(scene.name));
}

function filterActiveGates(gates: readonly GateMode[], args: readonly string[]): GateMode[] {
  const requested = cliValues(args, "--gate").at(-1)?.trim() ?? "all";
  if (requested === "all") return [...gates];
  if (requested !== "coverage" && requested !== "perf") {
    throw new Error(`Unknown --gate value: ${requested}. Valid gates: coverage, perf, all`);
  }
  return gates.filter((gate) => gate.name === requested);
}

const CLI_ARGS = process.argv.slice(2);
const PROFILE = parseProfile(CLI_ARGS);
const BASE_ACTIVE_SCENES = PROFILE === "fast"
  ? SCENES.filter((scene) => scene.name === "walk" || scene.name === "final-near")
  : PROFILE === "reuse"
    ? [...SCENES.filter((scene) => !scene.movementRoute), ...SCENES.filter((scene) => scene.movementRoute)]
    : SCENES;
const ACTIVE_SCENES = filterActiveScenes(BASE_ACTIVE_SCENES, CLI_ARGS);
const ACTIVE_GATES = filterActiveGates(GATE_MODES, CLI_ARGS);
const SAMPLE_FRAMES = PROFILE === "fast" ? FAST_SAMPLE_FRAMES : DEFAULT_SAMPLE_FRAMES;

function elapsedSeconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function timestampForFolder(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function horizontalDistance(a: PoseTuple, b: PoseTuple): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function numCounter(counters: Readonly<Record<string, number>>, key: string): number {
  const value = counters[key];
  return Number.isFinite(value) ? value : 0;
}

function numTiming(timings: Readonly<Record<string, number>>, key: string): number {
  const value = timings[key];
  return Number.isFinite(value) ? value : 0;
}

function numericCounter(stats: JsonRecord, key: string): number {
  const counters = stats["counters"] as Record<string, unknown> | undefined;
  const value = counters?.[key] ?? stats[key];
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

async function createAcceptancePage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
  return page;
}

function parseCamPose(cam: string | undefined): CamPose | null {
  if (!cam) return null;
  const parts = cam.split(",").map((part) => Number(part));
  if (parts.length < 5 || parts.some((value) => !Number.isFinite(value))) return null;
  return { p: [parts[0]!, parts[1]!, parts[2]!], yaw: parts[3]!, pitch: parts[4]!, fov: Number.isFinite(parts[5]) ? parts[5] : undefined };
}

function initialPoseForScene(scene: SceneSpec): CamPose | null {
  const camPose = parseCamPose(scene.cam);
  if (camPose) return camPose;
  const x = Number(scene.extra?.["x"]);
  const z = Number(scene.extra?.["z"]);
  const yaw = Number(scene.extra?.["yaw"]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return parseCamPose(OUTSIDE_STARTUP_CAM);
  return { p: [x, 96, z], yaw: Number.isFinite(yaw) ? yaw : 2.65, pitch: -0.43, fov: 55 };
}

async function configureReusedScenePage(page: Page, url: string, scene: SceneSpec): Promise<void> {
  const pose = initialPoseForScene(scene);
  await page.evaluate((input) => {
    window.history.replaceState(null, "", input.url);
    const hooks = window.__drusnielClod;
    hooks?.setAcceptanceSceneOptions?.({ freeze: input.freeze, proceduralDebug: input.proceduralDebug });
    if (input.pose) {
      if (typeof hooks?.resetAcceptanceSceneForPose === "function") {
        hooks.resetAcceptanceSceneForPose(input.pose);
      } else {
        if (typeof hooks?.setPose !== "function") throw new Error("reused acceptance page requires __drusnielClod.setPose");
        hooks.setPose(input.pose);
        hooks?.resetAcceptanceScene?.();
      }
    } else {
      hooks?.resetAcceptanceScene?.();
    }
  }, { url, freeze: scene.freeze, proceduralDebug: scene.proceduralDebug ?? null, pose });
}

function maxCounter(samples: readonly MovementSnapshot[], key: string): number {
  return samples.reduce((max, sample) => Math.max(max, numCounter(sample.counters, key)), 0);
}

function counterDelta(samples: readonly MovementSnapshot[], key: string): number {
  if (samples.length === 0) return 0;
  return Math.max(0, maxCounter(samples, key) - numCounter(samples[0]!.counters, key));
}

function outsideStartupWorld(pose: PoseTuple, worldCells: number): boolean {
  if (!Number.isFinite(worldCells) || worldCells <= 0) return false;
  return pose[0] < 0 || pose[2] < 0 || pose[0] >= worldCells || pose[2] >= worldCells;
}

async function writeBootstrapDiff(aPath: string, outPath: string): Promise<void> {
  const metadata = await sharp(aPath).metadata();
  const width = Math.max(1, metadata.width ?? WIDTH);
  const height = Math.max(1, metadata.height ?? HEIGHT);
  const diff = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(aPath).composite([{ input: diff, left: 0, top: 0 }]).png().toFile(outPath);
}

function qaSummary(scene: string, stats: JsonRecord): JsonRecord {
  return buildInfiniteQaSummary(scene, stats);
}

async function waitReady(page: Page, sceneName: string, failedPath: string): Promise<void> {
  await page.waitForFunction(
    () => {
      const hooks = (window as typeof window & { __drusnielClod?: { ready?: boolean; error?: string | null; progress?: number; progressMsg?: string } }).__drusnielClod;
      return Boolean(hooks && (hooks.ready === true || hooks.error != null || (hooks.progressMsg === "ready" && (hooks.progress ?? 0) >= 1)));
    },
    undefined,
    { timeout: READY_TIMEOUT_MS, polling: 250 },
  ).catch(async () => {
    const progress = await page.evaluate(() => {
      const hooks = (window as typeof window & { __drusnielClod?: { progress?: number; progressMsg?: string } }).__drusnielClod;
      return hooks ? `${hooks.progressMsg ?? "unknown"} (${hooks.progress ?? 0})` : "no hooks";
    });
    throw new Error(`${sceneName}: timed out waiting for ready; last progress: ${progress}`);
  });

  const appError = await page.evaluate(() => {
    const hooks = (window as typeof window & { __drusnielClod?: { error?: string | null } }).__drusnielClod;
    return hooks?.error ?? null;
  });
  if (appError) {
    await page.screenshot({ path: failedPath }).catch(() => undefined);
    throw new Error(`${sceneName}: app reported fatal error: ${appError}`);
  }
}

async function failOnPageError(page: Page, sceneName: string, pageErrors: string[], failedPath: string): Promise<void> {
  const first = pageErrors[0];
  if (!first) return;
  await page.screenshot({ path: failedPath }).catch(() => undefined);
  throw new Error(`${sceneName}: page error: ${first}`);
}

async function readStats(page: Page): Promise<JsonRecord> {
  return await page.evaluate(() => {
    const w = window as typeof window & {
      __drusnielClod?: { ready?: boolean; error?: string | null; diag?: unknown; startupTimings?: Record<string, number> | null; stats?: Record<string, unknown> | null };
      __drusnielStartupTimings?: Record<string, number>;
      __drusnielAcceptanceWorldCacheKey?: unknown;
    };
    const hooks = w.__drusnielClod;
    return JSON.parse(JSON.stringify({
      ready: hooks?.ready ?? false,
      error: hooks ? hooks.error ?? null : "missing hooks",
      diag: hooks?.diag ?? null,
      startupTimings: hooks?.startupTimings ?? w.__drusnielStartupTimings ?? null,
      acceptanceCacheKey: w.__drusnielAcceptanceWorldCacheKey ?? null,
      ...(hooks?.stats ?? {}),
    })) as Record<string, unknown>;
  });
}

async function readAcceptanceCacheKey(page: Page): Promise<JsonRecord | null> {
  return await page.evaluate(() => {
    const w = window as typeof window & { __drusnielAcceptanceWorldCacheKey?: unknown };
    return w.__drusnielAcceptanceWorldCacheKey ? JSON.parse(JSON.stringify(w.__drusnielAcceptanceWorldCacheKey)) as Record<string, unknown> : null;
  });
}

async function readStartupTimings(page: Page): Promise<Record<string, number>> {
  return await page.evaluate(() => {
    const w = window as typeof window & { __drusnielClod?: { startupTimings?: Record<string, number> | null }; __drusnielStartupTimings?: Record<string, number> };
    const hooks = w.__drusnielClod;
    return JSON.parse(JSON.stringify(hooks?.startupTimings ?? w.__drusnielStartupTimings ?? {})) as Record<string, number>;
  });
}

async function readPhase0Report(page: Page): Promise<JsonRecord> {
  return await page.evaluate(() => {
    const report = (window as typeof window & { __drusnielPhase0Report?: unknown }).__drusnielPhase0Report;
    return report ? { available: true, report: JSON.parse(JSON.stringify(report)) } : { available: false };
  });
}

async function settle(page: Page, frames: number): Promise<void> {
  await settlePage(page, frames, SETTLE_TIMEOUT_MS);
}

async function waitForConvergence(page: Page, sceneName: string): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + CONVERGENCE_TIMEOUT_MS;
  let stablePolls = 0;
  let lastSnapshot = "";
  while (Date.now() < deadline) {
    const c = await page.evaluate(() => {
      const counters = (window as typeof window & { __drusnielClod?: { stats?: { counters?: Record<string, number> } | null } }).__drusnielClod?.stats?.counters ?? {};
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
        bubbleColliderPages: counters["live_bubble_streamed_collider_pages"] ?? -1,
        bubbleColliderRegistrations: counters["live_bubble_collider_registrations"] ?? -1,
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
      };
    }) as ConvergenceSnapshot;
    const { quiet } = evaluateConvergence(c);
    if (c.streamRequired > 0 && c.streamBudget === 0) {
      const blockers = convergenceTimeoutBlockers(c);
      const message = `${sceneName}: streamed CLOD required but build budget is zero`;
      if (blockers.length > 0) console.log(`[infinite-accept] ${sceneName}: timeout blockers:\n${blockers.join("\n")}`);
      throw new Error(message);
    }
    if (c.streamRequired > 0 && c.streamSafetyCacheCapacityOk === 0) {
      const blockers = convergenceTimeoutBlockers(c);
      const message = `${sceneName}: CLOD safety set cannot fit cache`;
      if (blockers.length > 0) console.log(`[infinite-accept] ${sceneName}: timeout blockers:\n${blockers.join("\n")}`);
      throw new Error(message);
    }
    stablePolls = quiet ? stablePolls + 1 : 0;
    if (stablePolls >= CONVERGENCE_STABLE_POLLS) {
      console.log(`[infinite-accept] ${sceneName}: converged after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      return;
    }
    lastSnapshot = JSON.stringify(c);
    await page.waitForTimeout(CONVERGENCE_POLL_MS);
  }
  const last = JSON.parse(lastSnapshot || "{}") as ConvergenceSnapshot;
  console.log(`[infinite-accept] ${sceneName}: convergence wait timed out after ${(CONVERGENCE_TIMEOUT_MS / 1000).toFixed(0)}s; last ${lastSnapshot}`);
  const blockers = convergenceTimeoutBlockers(last);
  if (blockers.length > 0) console.log(`[infinite-accept] ${sceneName}: timeout blockers:\n${blockers.join("\n")}`);
}

async function beginMovementRouteProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hook = (window as typeof window & { __drusnielClod?: { beginMovementRouteProbe?: (() => void) | null } }).__drusnielClod?.beginMovementRouteProbe;
    if (typeof hook !== "function") throw new Error("movement route requires __drusnielClod.beginMovementRouteProbe");
    hook();
  });
}

async function readMovementSnapshot(page: Page, label: string): Promise<MovementSnapshot> {
  return await page.evaluate((sampleLabel) => {
    const hooks = (window as typeof window & { __drusnielClod?: { getPose?: (() => { p: [number, number, number] }) | null; stats?: { counters?: Record<string, number> } | null } }).__drusnielClod;
    const pose = hooks?.getPose?.();
    if (!pose) throw new Error("movement route requires __drusnielClod.getPose");
    return JSON.parse(JSON.stringify({ label: sampleLabel, pose: pose.p, counters: hooks?.stats?.counters ?? {} })) as MovementSnapshot;
  }, label);
}

async function readAutomationPose(page: Page): Promise<CamPose> {
  return await page.evaluate(() => {
    const pose = (window as typeof window & { __drusnielClod?: { getPose?: (() => { p: [number, number, number]; yaw: number; pitch: number; fov?: number }) | null } }).__drusnielClod?.getPose?.();
    if (!pose) throw new Error("movement route requires __drusnielClod.getPose");
    return JSON.parse(JSON.stringify(pose)) as CamPose;
  });
}

async function setAutomationPose(page: Page, pose: CamPose): Promise<void> {
  await page.evaluate((nextPose) => {
    const setPose = (window as typeof window & { __drusnielClod?: { setPose?: ((pose: CamPose) => void) | null } }).__drusnielClod?.setPose;
    if (typeof setPose !== "function") throw new Error("movement route requires __drusnielClod.setPose");
    setPose(nextPose);
  }, pose);
}

async function runMovementSegment(page: Page, segment: MovementSegment, samples: MovementSnapshot[]): Promise<void> {
  const start = await readAutomationPose(page);
  const target: CamPose = { ...start, p: [start.p[0] + segment.dx, start.p[1], start.p[2] + segment.dz] };
  let elapsedFrames = 0;
  let sampleIndex = 0;
  while (elapsedFrames < segment.frames) {
    const frames = Math.min(MOVEMENT_SAMPLE_FRAMES, segment.frames - elapsedFrames);
    elapsedFrames += frames;
    const t = elapsedFrames / segment.frames;
    await setAutomationPose(page, { ...start, p: [start.p[0] + (target.p[0] - start.p[0]) * t, start.p[1], start.p[2] + (target.p[2] - start.p[2]) * t] });
    await settle(page, frames);
    samples.push(await readMovementSnapshot(page, `${segment.label}:${sampleIndex}`));
    sampleIndex++;
  }
}

async function runMovementRoute(page: Page): Promise<MovementReport> {
  const samples: MovementSnapshot[] = [];
  await beginMovementRouteProbe(page);
  samples.push(await readMovementSnapshot(page, "start"));
  for (const segment of WALK_ROUTE) await runMovementSegment(page, segment, samples);
  const start = samples[0]!.pose;
  const end = samples.at(-1)!.pose;
  const worldCells = maxCounter(samples, "world_cells");
  return {
    start,
    end,
    horizontalDistanceM: horizontalDistance(start, end),
    worldCells,
    startedOutsideStartupWorld: outsideStartupWorld(start, worldCells),
    endedOutsideStartupWorld: outsideStartupWorld(end, worldCells),
    maxLiveBubbleReadyPages: maxCounter(samples, "live_bubble_ready_pages"),
    maxLiveBubbleBuiltThisFrame: maxCounter(samples, "live_bubble_built_this_frame"),
    liveBubbleBuiltDelta: counterDelta(samples, "live_bubble_built_total"),
    maxStreamCachedPages: maxCounter(samples, "live_clod_stream_cached_pages"),
    maxStreamApplyPagesThisFrame: maxCounter(samples, "live_clod_stream_apply_pages_this_frame"),
    streamApplyPagesDelta: counterDelta(samples, "live_clod_stream_apply_pages_total"),
    maxStreamEvictions: maxCounter(samples, "live_clod_stream_evictions"),
    maxStreamStaleDiscards: maxCounter(samples, "live_clod_stream_stale_discards"),
    streamEvictionsDelta: counterDelta(samples, "live_clod_stream_evictions_total"),
    streamStaleDiscardsDelta: counterDelta(samples, "live_clod_stream_stale_discards_total"),
    samples,
  };
}

function evaluateMovementRoute(sceneName: string, movement: MovementReport | null): string[] {
  if (!movement) return [];
  const failures: string[] = [];
  if (movement.horizontalDistanceM < MIN_WALK_ROUTE_DISTANCE_M) failures.push(`${sceneName}: movement route distance ${movement.horizontalDistanceM.toFixed(2)}m < ${MIN_WALK_ROUTE_DISTANCE_M}m`);
  if (!movement.startedOutsideStartupWorld) failures.push(`${sceneName}: movement route did not start outside startup world`);
  if (!movement.endedOutsideStartupWorld) failures.push(`${sceneName}: movement route did not end outside startup world`);
  if (movement.maxLiveBubbleReadyPages <= 0) failures.push(`${sceneName}: movement route never observed ready live-bubble pages`);
  if (movement.liveBubbleBuiltDelta <= 0) failures.push(`${sceneName}: movement route never built a live-bubble page during motion`);
  if (movement.maxStreamCachedPages <= 0) failures.push(`${sceneName}: movement route never observed cached streamed CLOD roots`);
  if (movement.streamApplyPagesDelta <= 0) failures.push(`${sceneName}: movement route never applied streamed CLOD roots during motion`);
  if (movement.streamEvictionsDelta + movement.streamStaleDiscardsDelta <= 0) failures.push(`${sceneName}: movement route never exercised streamed CLOD eviction or stale-discard paths`);
  return failures;
}

function evaluateStoneGpuCounters(stats: JsonRecord): string[] {
  const failures: string[] = [];
  const counters = (stats["counters"] as Record<string, unknown> | undefined) ?? {};
  const total = numericCounter(stats, "stoneGpuClustersTotal");
  const accepted = numericCounter(stats, "stoneGpuClustersAccepted");
  const rejected = numericCounter(stats, "stoneGpuClustersRejectedEarly");
  const vegetationTotal = numericCounter(stats, "vegetationGpuClustersTotal");
  const centerDistance = numericCounter(stats, "camera_to_vegetation_ring_center_m");
  if (!(total > 0)) failures.push(`stoneGpuClustersTotal=${total} must be > 0; this validates the real WebGPU stone path and will fail in headless/SwiftShader`);
  if (!Number.isFinite(accepted) || accepted < 0) failures.push(`stoneGpuClustersAccepted=${accepted} must be finite and >= 0`);
  if (!Number.isFinite(rejected) || rejected < 0) failures.push(`stoneGpuClustersRejectedEarly=${rejected} must be finite and >= 0`);
  if (Number.isFinite(total) && Number.isFinite(accepted) && Number.isFinite(rejected) && accepted + rejected > total) failures.push(`stone accepted+rejected ${accepted + rejected} exceeds total ${total}`);
  if (Number.isFinite(total) && (!(vegetationTotal >= total))) failures.push(`vegetationGpuClustersTotal=${vegetationTotal} must include stone total ${total}`);
  if (Number.isFinite(centerDistance) && !(centerDistance <= 8)) failures.push(`camera_to_vegetation_ring_center_m=${centerDistance} must be <= 8`);
  for (const key of ["stoneReject.below_water", "stoneReject.too_steep", "stoneReject.outside_world", "stoneReject.too_far", "stoneReject.density_mask", "stoneReject.tile_budget", "stoneReject.class_budget", "stoneReject.terrain_hidden"]) {
    const value = numericCounter(stats, key);
    if (Number.isFinite(value) && value < 0) failures.push(`${key}=${value} must be >= 0`);
  }
  const forbidden = Object.keys(counters).filter((key) => key.startsWith("veg_gpu_"));
  if (forbidden.length > 0) failures.push(`forbidden veg_gpu_* counters present: ${forbidden.join(", ")}`);
  return failures;
}

function evaluatePhase6CanopyCounters(stats: JsonRecord): string[] {
  const failures: string[] = [];
  const enabled = numericCounter(stats, "canopy_gpu_impostor_enabled");
  const instances = numericCounter(stats, "canopy_gpu_impostor_instances");
  const shellTris = numericCounter(stats, "canopy_shell_tris");
  const maxColor = numericCounter(stats, "canopy_gpu_impostor_max_color_channel");
  const opacity = numericCounter(stats, "canopy_gpu_impostor_opacity");
  const shaderDisplacement = numericCounter(stats, "far_clipmap_shader_displacement_enabled");
  const pendingTiles = numericCounter(stats, "far_clipmap_pending_tiles");
  if (enabled !== 1) failures.push(`canopy_gpu_impostor_enabled=${enabled} must equal 1`);
  if (!(instances > 0)) failures.push(`canopy_gpu_impostor_instances=${instances} must be > 0`);
  if (Number.isFinite(instances) && Number.isFinite(shellTris) && shellTris !== instances * 2) failures.push(`canopy_shell_tris=${shellTris} must equal canopy_gpu_impostor_instances*2 (${instances * 2})`);
  if (!(maxColor <= 0.42)) failures.push(`canopy_gpu_impostor_max_color_channel=${maxColor} must be <= 0.42`);
  if (!(opacity < 0.7)) failures.push(`canopy_gpu_impostor_opacity=${opacity} must be < 0.7`);
  if (shaderDisplacement !== 1) failures.push(`far_clipmap_shader_displacement_enabled=${shaderDisplacement} must equal 1`);
  if (pendingTiles !== 0) failures.push(`far_clipmap_pending_tiles=${pendingTiles} must equal 0`);
  return failures;
}

function evaluateFarSummaryGpuAuthoritativeCounters(stats: JsonRecord): string[] {
  const failures: string[] = [];
  const enabled = numericCounter(stats, "far_summary_gpu_enabled");
  const deviceReady = numericCounter(stats, "far_summary_gpu_device_ready");
  const authoritative = numericCounter(stats, "far_summary_gpu_authoritative");
  const lastCommittedTiles = numericCounter(stats, "far_summary_gpu_last_committed_tiles");
  const totalCommittedTiles = numericCounter(stats, "far_summary_gpu_total_committed_tiles");
  const suppressed = numericCounter(stats, "far_summary_cpu_builds_suppressed");
  const fallbackTiles = numericCounter(stats, "far_summary_gpu_fallback_tiles");
  const runtimeError = numericCounter(stats, "far_summary_gpu_runtime_error");
  const dispatchedTiles = numericCounter(stats, "far_summary_gpu_tiles_dispatched");
  if (enabled !== 1) failures.push(`far_summary_gpu_enabled=${enabled} must equal 1`);
  if (deviceReady !== 1) failures.push(`far_summary_gpu_device_ready=${deviceReady} must equal 1`);
  if (authoritative !== 1) failures.push(`far_summary_gpu_authoritative=${authoritative} must equal 1`);
  if (!(lastCommittedTiles > 0)) failures.push(`far_summary_gpu_last_committed_tiles=${lastCommittedTiles} must be > 0`);
  if (!(totalCommittedTiles >= lastCommittedTiles && totalCommittedTiles > 0)) failures.push(`far_summary_gpu_total_committed_tiles=${totalCommittedTiles} must be >= last committed ${lastCommittedTiles} and > 0`);
  if (suppressed !== 1) failures.push(`far_summary_cpu_builds_suppressed=${suppressed} must equal 1`);
  if (fallbackTiles !== 0) failures.push(`far_summary_gpu_fallback_tiles=${fallbackTiles} must equal 0`);
  if (runtimeError !== 0) failures.push(`far_summary_gpu_runtime_error=${runtimeError} must equal 0`);
  if (!(dispatchedTiles > 0)) failures.push(`far_summary_gpu_tiles_dispatched=${dispatchedTiles} must be > 0`);
  return failures;
}

function evaluateSceneSpecificCounters(scene: SceneSpec, stats: JsonRecord): string[] {
  if (scene.validation === "stone-gpu") return evaluateStoneGpuCounters(stats);
  if (scene.validation === "phase6-canopy") return evaluatePhase6CanopyCounters(stats);
  if (scene.validation === "far-summary-gpu-authoritative") return evaluateFarSummaryGpuAuthoritativeCounters(stats);
  return [];
}

function shouldSkipGenericConvergence(scene: SceneSpec): boolean {
  return scene.validation === "stone-gpu" || scene.validation === "far-summary-gpu-authoritative";
}

function failedImageSanity(message = "screenshot was not captured"): ImageSanityResult {
  return { passed: false, failures: [message], width: 0, height: 0, meanLuma: 0, rgbStddev: 0, meanAlpha: 0 };
}

async function runScene(page: Page, scene: SceneSpec, gate: GateMode, outDir: string, options: RunSceneOptions): Promise<SceneResult> {
  const consoleWarnings: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let rejectPageError: ((error: Error) => void) | null = null;
  const pageErrorGate = new Promise<never>((_, reject) => { rejectPageError = reject; });
  pageErrorGate.catch(() => undefined);
  const loggedConsoleMessages = new Set<string>();
  let printedConsoleMessages = 0;
  let printedPageErrors = 0;
  let suppressedPageErrorNotice = false;
  const sceneRunName = `${gate.name}-${scene.name}`;
  const screenshotPath = resolve(outDir, `${sceneRunName}.png`);
  const failedPath = screenshotPath.replace(/\.png$/i, "-FAILED.png");
  const statsPath = resolve(outDir, `${sceneRunName}-stats.json`);
  const phase0Path = resolve(outDir, `${sceneRunName}-phase0-report.json`);
  const summaryPath = scene.summary ? resolve(outDir, `${sceneRunName}-summary.json`) : null;
  const movementPath = scene.movementRoute ? resolve(outDir, `${sceneRunName}-movement.json`) : null;
  const comparisonPath = resolve(outDir, `compare/${sceneRunName}-self-diff.png`);
  let movement: MovementReport | null = null;

  const onConsole = (msg: ConsoleMessage) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "warning") consoleWarnings.push(text);
    if (type === "error") consoleErrors.push(text);
    if ((type === "warning" || type === "error") && printedConsoleMessages < CONSOLE_PRINT_LIMIT) {
      const key = `${type}:${text}`;
      if (!loggedConsoleMessages.has(key)) {
        loggedConsoleMessages.add(key);
        printedConsoleMessages++;
        console.log(`[page:${type}] ${text}`);
      }
    }
  };
  const onPageError = (error: Error) => {
    if (pageErrors.length < PAGE_ERROR_STORE_LIMIT) pageErrors.push(error.message);
    rejectPageError?.(new Error(`${scene.name}: page error: ${error.message}`));
    if (printedPageErrors < PAGE_ERROR_PRINT_LIMIT) {
      printedPageErrors++;
      console.log(`[page:error] ${error.message}`);
    } else if (!suppressedPageErrorNotice) {
      suppressedPageErrorNotice = true;
      console.log("[page:error] further page errors suppressed");
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  const extra: Record<string, string> = { acceptance: "1", acceptanceReuse: PROFILE, acceptanceReuseMode: String(REUSE_MODE_CODES[PROFILE]), ownershipOracle: gate.ownershipOracle, world: "16", clodPerf: "1", webgpuSelection: "1", ...profileAcceptanceParams(PROFILE), ...(scene.extra ?? {}) };
  if (PROFILE === "fast") {
    extra["startupWorld"] = FAST_STARTUP_WORLD;
    extra["infiniteStartupWorld"] = FAST_STARTUP_WORLD;
  }
  if (scene.proceduralDebug) extra["proceduralDebug"] = scene.proceduralDebug;
  const url = clodUrl({ scene: "infinite-islands", seed: 1, hud: true, freeze: scene.freeze, cam: scene.cam, extra });

  console.log(`[infinite-accept] ${gate.name}/${scene.name}: ${url}`);
  try {
    const sceneStartedAt = Date.now();
    if (!options.reusePage || options.firstSceneOnPage) {
      const loadStartedAt = Date.now();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      console.log(`[infinite-accept] ${sceneRunName}: loaded after ${elapsedSeconds(loadStartedAt)} (total ${elapsedSeconds(sceneStartedAt)})`);
    } else {
      const reuseStartedAt = Date.now();
      await configureReusedScenePage(page, url, scene);
      console.log(`[infinite-accept] ${sceneRunName}: reused page after ${elapsedSeconds(reuseStartedAt)} (total ${elapsedSeconds(sceneStartedAt)})`);
    }
    const readyStartedAt = Date.now();
    await Promise.race([waitReady(page, sceneRunName, failedPath), pageErrorGate]);
    if (options.reusePage && options.firstSceneOnPage) await configureReusedScenePage(page, url, scene);
    console.log(`[infinite-accept] ${sceneRunName}: ready after ${elapsedSeconds(readyStartedAt)} (total ${elapsedSeconds(sceneStartedAt)})`);
    const startupTimings = await readStartupTimings(page).catch((): Record<string, number> => ({}));
    if (Object.keys(startupTimings).length > 0) {
      console.log(
        `[infinite-accept] ${sceneRunName}: startup timings ` +
        `parse=${(startupTimings["startup.parse_configs_ms"] ?? 0).toFixed(1)}ms ` +
        `textures=${(startupTimings["startup.procedural_textures_ms"] ?? 0).toFixed(1)}ms ` +
        `hydrology=${(startupTimings["startup.hydrology_ms"] ?? 0).toFixed(1)}ms ` +
        `build=${(startupTimings["startup.build_world_ms"] ?? 0).toFixed(1)}ms ` +
        `summary=${(startupTimings["startup.terrain_summary_ms"] ?? 0).toFixed(1)}ms ` +
        `firstRender=${(startupTimings["startup.first_render_ready_ms"] ?? 0).toFixed(1)}ms ` +
        `configuredWorld=${startupTimings["startup.configured_world_pages"] ?? "?"} ` +
        `startupWorld=${startupTimings["startup.world_pages"] ?? "?"}`,
      );
    }
    const reusedScene = options.reusePage && !options.firstSceneOnPage;
    const cacheEvidence = cacheEvidenceFromTimings(startupTimings, reusedScene);
    console.log(`[infinite-accept] ${sceneRunName}: scene boot: cache ${cacheEvidence.clodCacheHit === 1 ? "hit" : "miss"} buildWorld=${cacheEvidence.startupBuildWorldMs.toFixed(1)}ms terrainSummary=${cacheEvidence.startupTerrainSummaryMs.toFixed(1)}ms ready=${elapsedSeconds(readyStartedAt)}`);
    await failOnPageError(page, scene.name, pageErrors, failedPath);
    await Promise.race([settle(page, WARMUP_FRAMES), pageErrorGate]);
    await failOnPageError(page, scene.name, pageErrors, failedPath);
    if (shouldSkipGenericConvergence(scene)) {
      console.log(`[infinite-accept] ${sceneRunName}: skipping generic convergence wait for ${scene.validation} validation`);
    } else {
      await Promise.race([waitForConvergence(page, sceneRunName), pageErrorGate]);
    }
    await failOnPageError(page, scene.name, pageErrors, failedPath);
    if (scene.movementRoute) {
      movement = await Promise.race([runMovementRoute(page), pageErrorGate]);
      if (movementPath) writeJson(movementPath, movement);
      await failOnPageError(page, scene.name, pageErrors, failedPath);
      await Promise.race([waitForConvergence(page, `${sceneRunName}:post-route`), pageErrorGate]);
      await failOnPageError(page, scene.name, pageErrors, failedPath);
    }
    const sampleStartedAt = Date.now();
    await Promise.race([settle(page, SAMPLE_FRAMES), pageErrorGate]);
    console.log(`[infinite-accept] ${sceneRunName}: sampled after ${elapsedSeconds(sampleStartedAt)} (total ${elapsedSeconds(sceneStartedAt)})`);
    await failOnPageError(page, scene.name, pageErrors, failedPath);
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: screenshotPath });
    const stats = await readStats(page);
    const finalStartupTimings = await readStartupTimings(page).catch((): Record<string, number> => startupTimings);
    const finalCacheEvidence = cacheEvidenceFromTimings(finalStartupTimings, reusedScene);
    const acceptanceCacheKey = await readAcceptanceCacheKey(page).catch(() => null);
    const phase0 = await readPhase0Report(page);
    writeJson(statsPath, stats);
    writeJson(phase0Path, phase0);
    if (summaryPath) writeJson(summaryPath, qaSummary("infinite-islands", stats));
    await writeBootstrapDiff(screenshotPath, comparisonPath);
    const imageSanity = await inspectPngSanity(screenshotPath, { width: WIDTH, height: HEIGHT });
    const thresholds: ThresholdEvaluation = scene.validation
      ? evaluateThresholds(extractAcceptanceCounters(stats), [], [])
      : evaluateThresholds(extractAcceptanceCounters(stats), gate.requiredCounters, gate.rules);
    const movementFailures = evaluateMovementRoute(scene.name, movement);
    const sceneSpecificFailures = evaluateSceneSpecificCounters(scene, stats);
    const failures = [...pageErrors.map((error) => `page error: ${error}`), ...thresholds.failures, ...movementFailures, ...sceneSpecificFailures, ...imageSanity.failures.map((failure) => `image sanity: ${failure}`)];
    return {
      name: `${gate.name}/${scene.name}`,
      url,
      screenshot: rel(screenshotPath),
      stats,
      statsPath: rel(statsPath),
      phase0Path: rel(phase0Path),
      summaryPath: summaryPath ? rel(summaryPath) : null,
      comparisonPath: rel(comparisonPath),
      thresholds,
      imageSanity,
      movement,
      startupTimings: finalStartupTimings,
      configuredWorldPages: numTiming(finalStartupTimings, "startup.configured_world_pages"),
      startupWorldPages: numTiming(finalStartupTimings, "startup.world_pages"),
      cache: finalCacheEvidence,
      acceptanceCacheKey,
      consoleWarnings,
      consoleErrors,
      pageErrors,
      failures,
      passed: failures.length === 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await page.screenshot({ path: failedPath }).catch(() => undefined);
    const stats = { ready: false, error: message };
    writeJson(statsPath, stats);
    writeJson(phase0Path, { available: false, error: message });
    if (movementPath && movement) writeJson(movementPath, movement);
    let imageSanity = failedImageSanity();
    if (existsSync(failedPath)) {
      imageSanity = await inspectPngSanity(failedPath, { width: WIDTH, height: HEIGHT }).catch((sanityError: unknown) => failedImageSanity(`screenshot sanity failed: ${sanityError instanceof Error ? sanityError.message : String(sanityError)}`));
      await writeBootstrapDiff(failedPath, comparisonPath).catch(() => undefined);
    }
    const thresholds = evaluateThresholds({}, gate.requiredCounters, gate.rules);
    const startupTimings: Record<string, number> = {};
    const cache = cacheEvidenceFromTimings(startupTimings, options.reusePage && !options.firstSceneOnPage);
    const failures = [message, ...evaluateMovementRoute(scene.name, movement), ...imageSanity.failures.map((failure) => `image sanity: ${failure}`)];
    return {
      name: `${gate.name}/${scene.name}`,
      url,
      screenshot: existsSync(failedPath) ? rel(failedPath) : rel(screenshotPath),
      stats,
      statsPath: rel(statsPath),
      phase0Path: rel(phase0Path),
      summaryPath: summaryPath ? rel(summaryPath) : null,
      comparisonPath: rel(comparisonPath),
      thresholds,
      imageSanity,
      movement,
      startupTimings,
      configuredWorldPages: 0,
      startupWorldPages: 0,
      cache,
      acceptanceCacheKey: null,
      consoleWarnings,
      consoleErrors,
      pageErrors,
      failures,
      passed: false,
    };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

async function main(): Promise<void> {
  const timestamp = timestampForFolder();
  const outDir = resolve(RUN_ROOT, timestamp);
  mkdirSync(outDir, { recursive: true });
  console.log(`[infinite-accept] run ${rel(outDir)}`);
  console.log(`[infinite-accept] base ${process.env["CLOD_POC_BASE_URL"]}`);
  console.log(`[infinite-accept] profile ${PROFILE} gates=${ACTIVE_GATES.map((gate) => gate.name).join(",")} scenes=${ACTIVE_SCENES.map((scene) => scene.name).join(",")} sampleFrames=${SAMPLE_FRAMES}`);
  const { browser, recipe } = await launchWebGPU();
  const sceneResults: SceneResult[] = [];
  try {
    if (PROFILE === "reuse") {
      const page = await createAcceptancePage(browser);
      let firstSceneOnPage = true;
      try {
        for (const gate of ACTIVE_GATES) {
          for (const scene of ACTIVE_SCENES) {
            sceneResults.push(await runScene(page, scene, gate, outDir, { reusePage: true, firstSceneOnPage }));
            firstSceneOnPage = false;
          }
        }
      } finally {
        await page.close().catch(() => undefined);
      }
    } else {
      for (const gate of ACTIVE_GATES) {
        for (const scene of ACTIVE_SCENES) {
          const page = await createAcceptancePage(browser);
          try {
            sceneResults.push(await runScene(page, scene, gate, outDir, { reusePage: false, firstSceneOnPage: true }));
          } finally {
            await page.close().catch(() => undefined);
          }
        }
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  const failures = sceneResults.flatMap((scene) => scene.failures.map((failure) => `${scene.name}: ${failure}`));
  const passed = aggregatePassed(sceneResults, failures);
  const reportJsonPath = resolve(outDir, "report.json");
  const reportMdPath = resolve(outDir, "report.md");
  const firstStartupTimings = sceneResults[0]?.startupTimings ?? {};
  const report = {
    passed,
    timestamp,
    commit_sha: gitSha(),
    browser_launch_recipe: recipe,
    profile: PROFILE,
    sample_frames: SAMPLE_FRAMES,
    world_pages: { configured: numTiming(firstStartupTimings, "startup.configured_world_pages"), startup: numTiming(firstStartupTimings, "startup.world_pages") },
    thresholds: {
      required_counters: REQUIRED_COUNTERS,
      rules: THRESHOLD_RULES.map((rule) => ({ key: rule.key, label: rule.label })),
      coverage_required_counters: COVERAGE_REQUIRED_COUNTERS,
      coverage_rules: COVERAGE_RULES.map((rule) => ({ key: rule.key, label: rule.label })),
      perf_required_counters: PERF_REQUIRED_COUNTERS,
      perf_rules: PERF_RULES.map((rule) => ({ key: rule.key, label: rule.label })),
    },
    reference_status: "bootstrap",
    failures,
    scenes: sceneResults.map((scene) => ({
      name: scene.name,
      url: scene.url,
      passed: scene.passed,
      failures: scene.failures,
      console_warnings: scene.consoleWarnings,
      console_errors: scene.consoleErrors,
      page_errors: scene.pageErrors,
      thresholds: scene.thresholds,
      image_sanity: scene.imageSanity,
      movement: scene.movement,
      startup_timings: scene.startupTimings,
      configured_world_pages: scene.configuredWorldPages,
      startup_world_pages: scene.startupWorldPages,
      cache: scene.cache,
      acceptance_cache_key: scene.acceptanceCacheKey,
      artifacts: { screenshot: scene.screenshot, stats_json: scene.statsPath, phase0_report_json: scene.phase0Path, qa_summary_json: scene.summaryPath, visual_comparison: scene.comparisonPath },
    })),
    artifacts: { run_dir: rel(outDir), report_json: rel(reportJsonPath), report_md: rel(reportMdPath) },
  };
  writeJson(reportJsonPath, report);
  writeFileSync(reportMdPath, renderMarkdownReport({ passed, scenes: sceneResults, failures, reportJsonPath: rel(reportJsonPath) }));
  console.log(`[infinite-accept] report ${rel(reportJsonPath)}`);
  if (!passed) {
    console.error(`[infinite-accept] FAILED with ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log("[infinite-accept] ok");
}

main().catch((error: unknown) => {
  console.error("[infinite-accept] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
