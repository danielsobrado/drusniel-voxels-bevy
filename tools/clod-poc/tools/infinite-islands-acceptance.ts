import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import sharp from "sharp";
import type { Browser, ConsoleMessage, Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";
import { FRAME_PERF_BROAD_BUCKETS, FRAME_PERF_MATERIAL_CHURN_BUCKETS, FRAME_PERF_PROP_BUCKETS } from "../src/app/frame_loop/perf_probe_constants.js";
import { RPG_VILLAGE_CENTER } from "../src/scenes/rpg_density_scenes.js";
import { inspectPngSanity, type ImageSanityResult } from "./infinite_acceptance/image_sanity.js";
import { aggregatePassed, renderMarkdownReport, type SceneReportInput } from "./infinite_acceptance/report.js";
import { evaluateMovementCoverage, evaluateMovementPerformance } from "./infinite_acceptance/movement_performance.js";
import { requiresDedicatedMovementPage, resolveMovementRouteProfile, sceneForMovementCase, type MovementContentProfile, type MovementRouteName, type MovementSegment } from "./infinite_acceptance/movement_route_profile.js";
import { buildInfiniteQaSummary } from "./infinite_acceptance/qa_summary.js";
import { settlePage } from "./infinite_acceptance/page_settle.js";
import { resetAcceptanceSampleWindow } from "./infinite_acceptance/sample_window.js";
import { withSampledPerfCounters } from "./infinite_acceptance/sampled_perf_counters.js";
import { evaluateWaterAcceptance } from "./infinite_acceptance/water_acceptance.js";
import { percentile, summarizeFrameTimes, summarizeNumericEnvelope, type NumericEnvelope } from "./infinite_acceptance/route_metrics.js";
import {
  evaluateRevisitEviction,
  type ResidencySnapshot,
  type RevisitEvictionEvidence,
} from "./infinite_acceptance/revisit_eviction.js";
import {
  evaluateContinentRouteTails,
  type ContinentRouteTailThresholds,
} from "./infinite_acceptance/continent_route_thresholds.js";
import { hostEnvironmentRecord } from "./infinite_acceptance/host_environment.js";
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
  withFrameMsP95Max,
  type RequiredCounter,
  type ThresholdEvaluation,
  type ThresholdRule,
} from "./infinite_acceptance/thresholds.js";
import { RPG_DENSE_PRIMARY_TIER } from "./infinite_acceptance/rpg_dense_thresholds.js";

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
const MOVEMENT_SAMPLE_FRAMES = 30;
const MAX_ROUTE_FRAME_P99_MS = 100;
const MAX_ROUTE_FRAME_MS = 1500;
const MAX_ROUTE_WORK_UNIT_MS = 8;
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

// Infinite-islands acceptance validates the canonical unified-streaming renderer.
// Individual scenes may override these only when they are an explicit A/B case.
const UNIFIED_STREAMING_ACCEPTANCE_PARAMS: Readonly<Record<string, string>> = {
  farSummaryLayout: "2",
  farClipmap: "1",
  farClipmapMode: "replace",
};

function requestedMovementRoute(argv: readonly string[]): MovementRouteName {
  if (argv.includes("--revisit")) return "coast-to-coast-revisit";
  if (argv.includes("--coast-to-coast")) return "coast-to-coast";
  if (argv.includes("--short-route")) return "continent-short";
  if (argv.includes("--long-route")) return "long-route";
  return "walk";
}

const MOVEMENT_CONTENT_PROFILE: MovementContentProfile = process.argv.includes("--representative")
  ? "representative"
  : "infrastructure";
const MOVEMENT_ROUTE_PROFILE = resolveMovementRouteProfile(requestedMovementRoute(process.argv), MOVEMENT_CONTENT_PROFILE);
const WALK_ROUTE = MOVEMENT_ROUTE_PROFILE.segments;

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
    name: "water",
    freeze: false,
    // waterDebug=1: the river/lake spot finder needs window.waterProbe, which
    // only installs in dev mode or with an explicit debug flag — acceptance
    // must also pass against production (vite preview) builds.
    extra: { water: "1", waterQuality: "high", waterDebug: "1" },
    validation: "water",
    waterAcceptance: true,
    gates: ["perf"],
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
type SceneValidation = "stone-gpu" | "phase6-canopy" | "far-summary-gpu-authoritative" | "water";
type WaterShotName = "river-close" | "river-aerial" | "lake" | "shore";

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
  waterAcceptance?: boolean;
  gates?: readonly GateMode["name"][];
}

interface WaterSpot {
  x: number;
  z: number;
  terrain: number;
  water: number;
  depth: number;
  flowX: number;
  flowZ: number;
  bankX: number;
  bankZ: number;
}

interface WaterAcceptanceEvidence {
  shots: Record<WaterShotName, string>;
  river: WaterSpot;
  lake: WaterSpot;
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
  routeDistanceM: number;
  usedJsHeapBytes: number | null;
}

interface MovementFrameSample {
  frameId: number;
  frameMs: number;
  renderMs: number;
  phase: "outbound" | "revisit";
  metrics: Record<string, number>;
}

interface BucketEvidence {
  name: string;
  p95Ms: number;
  maxMs: number;
}

interface RevisitEconomics {
  clodPageBuilds: number;
  clodBuildMs: number;
  farSummaryTileBuilds: number;
  farSummaryBuildMs: number;
  heightfieldTileBuilds: number;
  heightfieldStoreHits: number;
  heightfieldStoreMisses: number;
  outboundFrameP99Ms: number;
  revisitFrameP99Ms: number;
  frameP99DeltaMs: number;
  outboundFrameMs: ReturnType<typeof summarizeFrameTimes>;
  revisitFrameMs: ReturnType<typeof summarizeFrameTimes>;
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
  liveBubbleEvictionsDelta: number;
  maxStreamCachedPages: number;
  maxStreamApplyPagesThisFrame: number;
  streamApplyPagesDelta: number;
  maxStreamEvictions: number;
  maxStreamStaleDiscards: number;
  streamEvictionsDelta: number;
  streamStaleDiscardsDelta: number;
  frameSampleCount: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  frameP999Ms: number;
  renderP95Ms: number;
  maxFrameMs: number;
  framesOver16_7Ms: number;
  framesOver33_3Ms: number;
  framesOver100Ms: number;
  longTaskCount: number;
  longestLongTaskMs: number;
  topPhaseBucket: BucketEvidence | null;
  topPropBucket: BucketEvidence | null;
  maxWorkUnitMs: number;
  maxPriorityUnownedCells: number;
  maxClodFarGapHoles: number;
  maxFarClipmapOwnershipHoles: number;
  frontierLagSampleCount: number;
  frontierLagP95M: number;
  maxHeightfieldFallbackSamples: number;
  maxSettledHeightfieldFallbackSamples: number;
  heapEnvelopeAfterWarmup: NumericEnvelope | null;
  resourceEnvelopes: Record<string, NumericEnvelope>;
  revisitEviction: RevisitEvictionEvidence | null;
  revisitEconomics: RevisitEconomics | null;
  worstFrames: Array<{
    frameId: number;
    frameMs: number;
    renderMs: number;
    phase: "outbound" | "revisit";
    metrics: Record<string, number>;
  }>;
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
  waterAcceptance: WaterAcceptanceEvidence | null;
}

interface RunSceneOptions {
  reusePage: boolean;
  firstSceneOnPage: boolean;
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
const CONTINENT_ROUTE = MOVEMENT_ROUTE_PROFILE.name === "continent-short"
  || MOVEMENT_ROUTE_PROFILE.name.startsWith("coast-to-coast");
const ROUTE_CALIBRATION = CONTINENT_ROUTE && CLI_ARGS.includes("--calibrate");
const DEFAULT_ROUTE_THRESHOLDS_PATH = MOVEMENT_CONTENT_PROFILE === "representative"
  ? (MOVEMENT_ROUTE_PROFILE.name.startsWith("coast-to-coast")
    ? "config/long_map_representative_full_route_thresholds.json"
    : "config/long_map_representative_route_thresholds.json")
  : "config/long_map_route_thresholds.json";
const ROUTE_THRESHOLDS_PATH = resolve(cliValues(CLI_ARGS, "--thresholds").at(-1) ?? DEFAULT_ROUTE_THRESHOLDS_PATH);
const ROUTE_TAIL_THRESHOLDS: ContinentRouteTailThresholds | null = CONTINENT_ROUTE && !ROUTE_CALIBRATION && existsSync(ROUTE_THRESHOLDS_PATH)
  ? JSON.parse(readFileSync(ROUTE_THRESHOLDS_PATH, "utf8")) as ContinentRouteTailThresholds
  : null;
if (CONTINENT_ROUTE && !ROUTE_CALIBRATION && !ROUTE_TAIL_THRESHOLDS) {
  throw new Error(`continent route thresholds are missing at ${ROUTE_THRESHOLDS_PATH}; run with --calibrate for a non-proof baseline capture`);
}
const BASE_ACTIVE_SCENES = PROFILE === "fast"
  ? SCENES.filter((scene) => scene.name === "walk" || scene.name === "final-near")
  : PROFILE === "reuse"
    ? [...SCENES.filter((scene) => !scene.movementRoute), ...SCENES.filter((scene) => scene.movementRoute)]
    : SCENES;
const ACTIVE_SCENES = filterActiveScenes(BASE_ACTIVE_SCENES, CLI_ARGS);
const ACTIVE_GATES = filterActiveGates(GATE_MODES, CLI_ARGS);
const SAMPLE_FRAMES = PROFILE === "fast" ? FAST_SAMPLE_FRAMES : DEFAULT_SAMPLE_FRAMES;
const REPEAT_COUNT = Math.max(1, Math.floor(Number(cliValues(CLI_ARGS, "--repeat").at(-1) ?? "1")) || 1);
/** Higher stream budgets only for pre-route convergence; restored before the route. */
const PRE_ROUTE_CONVERGENCE_STREAM_BUDGETS = {
  buildBudgetPagesPerFrame: 64,
  applyBudgetPagesPerFrame: 16,
  maxInflightBatches: 4,
  // Match representative production cache (1024). Infrastructure still restores to 512.
  maxCachedPages: 1024,
} as const;
const BUDGET_RESTORE_SETTLE_FRAMES = 30;
/** Restoring a lower inflight cap does not cancel batches launched under the boosted
 *  pre-route budget, and scene gates compare the live inflight counter against the
 *  restored max — wait (bounded) for launched batches to drain before sampling. */
const BUDGET_RESTORE_DRAIN_TIMEOUT_MS = 90_000;

function sceneSupportsGate(scene: SceneSpec, gate: GateMode): boolean {
  return !scene.gates || scene.gates.includes(gate.name);
}

if (!ACTIVE_GATES.some((gate) => ACTIVE_SCENES.some((scene) => sceneSupportsGate(scene, gate)))) {
  throw new Error("The requested scene/gate combination has no acceptance cases");
}

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

function numericCounters(stats: JsonRecord): Record<string, number> {
  const counters = (stats["counters"] as Record<string, unknown> | undefined) ?? {};
  return Object.fromEntries(
    Object.entries(counters).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

async function findWaterAcceptanceSpots(page: Page): Promise<{ river: WaterSpot; lake: WaterSpot }> {
  const spots = await page.evaluate<{ river: WaterSpot | null; lake: WaterSpot | null }>(`(() => {
    const probe = window.waterProbe;
    if (!probe) return { river: null, lake: null };
    const dirs = Array.from({ length: 24 }, (_, i) => {
      const angle = i / 24 * Math.PI * 2;
      return [Math.cos(angle), Math.sin(angle)];
    });
    const nearestBank = (x, z, maxRadius) => {
      for (let radius = 6; radius <= maxRadius; radius += 3) {
        for (const [dx, dz] of dirs) {
          const sample = probe(x + dx * radius, z + dz * radius);
          if (sample.depth <= 0.02 || sample.bodyMask <= 0.02) return { x: dx, z: dz };
        }
      }
      return null;
    };
    let river = null;
    let lake = null;
    let riverScore = -Infinity;
    let lakeScore = -Infinity;
    for (let z = 256; z <= 4096; z += 12) {
      for (let x = 256; x <= 4096; x += 12) {
        const sample = probe(x, z);
        if (sample.depth < 0.12 || sample.bodyMask < 0.05) continue;
        const flowLength = Math.hypot(sample.flowX, sample.flowZ);
        const isRiver = sample.bodyMask >= 0.3 && sample.flowSpeed >= 0.35;
        const isLake = sample.flowSpeed <= 0.001 && sample.depth <= 5;
        if (!isRiver && !isLake) continue;
        const bank = nearestBank(x, z, isLake ? 192 : 36);
        if (!bank) continue;
        const candidate = {
          x,
          z,
          terrain: sample.terrain,
          water: sample.water,
          depth: sample.depth,
          flowX: flowLength > 1e-4 ? sample.flowX / flowLength : 0,
          flowZ: flowLength > 1e-4 ? sample.flowZ / flowLength : 0,
          bankX: bank.x,
          bankZ: bank.z,
        };
        if (isRiver) {
          const score = sample.depth + Math.min(sample.flowSpeed, 3) * 0.5 + sample.bodyMask;
          if (score > riverScore) { river = candidate; riverScore = score; }
        } else if (isLake) {
          const score = sample.bodyMask + Math.min(sample.depth, 0.6);
          if (score > lakeScore) { lake = candidate; lakeScore = score; }
        }
      }
    }
    return { river, lake };
  })()`);
  if (!spots.river) throw new Error("water acceptance could not find a strong traced river spot");
  if (!spots.lake) throw new Error("water acceptance could not find a lake shoreline spot");
  return { river: spots.river, lake: spots.lake };
}

async function terrainAt(page: Page, x: number, z: number): Promise<number> {
  return page.evaluate<number>(`window.waterProbe(${x}, ${z}).terrain`);
}

async function moveWaterCamera(page: Page, pose: CamPose, label: string, waitForStreaming: boolean): Promise<void> {
  await page.evaluate((nextPose) => {
    window.__drusnielClod?.setPose?.(nextPose);
  }, pose);
  await settle(page, 60);
  if (waitForStreaming) await waitForConvergence(page, label);
  await settle(page, 30);
}

async function captureWaterAcceptance(page: Page, outDir: string, sceneRunName: string): Promise<WaterAcceptanceEvidence> {
  const { river, lake } = await findWaterAcceptanceSpots(page);
  const shots = {} as Record<WaterShotName, string>;
  const capture = async (name: WaterShotName) => {
    const path = resolve(outDir, `${sceneRunName}-${name}.png`);
    await page.screenshot({ path });
    shots[name] = rel(path);
  };

  const riverCloseX = river.x - river.flowX * 70;
  const riverCloseZ = river.z - river.flowZ * 70;
  await moveWaterCamera(page, {
    p: [riverCloseX, (await terrainAt(page, riverCloseX, riverCloseZ)) + 20, riverCloseZ],
    yaw: Math.atan2(-river.flowX, -river.flowZ),
    pitch: -0.3,
    fov: 55,
  }, `${sceneRunName}:river`, true);
  await capture("river-close");

  await moveWaterCamera(page, {
    p: [river.x, river.terrain + 460, river.z],
    yaw: Math.atan2(-river.flowX, -river.flowZ),
    pitch: -1.55,
    fov: 55,
  }, `${sceneRunName}:river-aerial`, false);
  await capture("river-aerial");

  const lakeCameraX = lake.x + lake.bankX * 28;
  const lakeCameraZ = lake.z + lake.bankZ * 28;
  const lakeYaw = Math.atan2(lake.bankX, lake.bankZ);
  await moveWaterCamera(page, {
    p: [lakeCameraX, (await terrainAt(page, lakeCameraX, lakeCameraZ)) + 16, lakeCameraZ],
    yaw: lakeYaw,
    pitch: -0.28,
    fov: 55,
  }, `${sceneRunName}:lake`, true);
  await capture("lake");

  const shoreCameraX = lake.x + lake.bankX * 10;
  const shoreCameraZ = lake.z + lake.bankZ * 10;
  await moveWaterCamera(page, {
    p: [shoreCameraX, (await terrainAt(page, shoreCameraX, shoreCameraZ)) + 7, shoreCameraZ],
    yaw: lakeYaw,
    pitch: -0.18,
    fov: 55,
  }, `${sceneRunName}:shore`, false);
  await capture("shore");
  // Keep camera/atlas recenter work out of the sampled proof window.
  await settle(page, 120);

  return { shots, river, lake };
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
  if (scene.movementRoute && MOVEMENT_ROUTE_PROFILE.start) {
    const [x, y, z] = MOVEMENT_ROUTE_PROFILE.start;
    return { p: [x, y, z], yaw: Math.PI / 2, pitch: -0.43, fov: 55 };
  }
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

function percentile95(values: readonly number[]): number {
  return percentile(values, 0.95);
}

function topBucket(samples: readonly MovementFrameSample[], keys: readonly string[]): BucketEvidence | null {
  let best: BucketEvidence | null = null;
  for (const key of keys) {
    const values = samples.map((sample) => sample.metrics[key] ?? 0);
    const p95Ms = percentile95(values);
    const maxMs = values.length > 0 ? Math.max(...values) : 0;
    if (Number.isFinite(p95Ms) && (!best || p95Ms > best.p95Ms)) best = { name: key, p95Ms, maxMs };
  }
  return best;
}

function worstMovementFrames(samples: readonly MovementFrameSample[], limit = 5): MovementReport["worstFrames"] {
  return samples
    .slice()
    .sort((left, right) => right.frameMs - left.frameMs)
    .slice(0, limit)
    .map((sample) => ({
      frameId: sample.frameId,
      frameMs: sample.frameMs,
      renderMs: sample.renderMs,
      phase: sample.phase,
      metrics: Object.fromEntries(
        Object.entries(sample.metrics)
          .filter(([, value]) => Number.isFinite(value) && value > 0)
          .sort((left, right) => right[1] - left[1])
          .slice(0, 12),
      ),
    }));
}

function resourceEnvelopes(samples: readonly MovementSnapshot[]): Record<string, NumericEnvelope> {
  const keys = new Set<string>();
  for (const sample of samples) {
    for (const key of Object.keys(sample.counters)) {
      if (/(resident|cached|cache_size|ready_pages|geometries|textures|programs|buffer_bytes|bind_groups)/.test(key)) keys.add(key);
    }
  }
  const result: Record<string, NumericEnvelope> = {};
  for (const key of [...keys].sort()) {
    const envelope = summarizeNumericEnvelope(samples.map((sample) => sample.counters[key] ?? 0));
    if (envelope) result[key] = envelope;
  }
  return result;
}

async function startLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __drusnielLongTasks?: number[];
      __drusnielLongTaskObserver?: PerformanceObserver;
    };
    scope.__drusnielLongTasks = [];
    // Reused pages run several movement routes; a single observer per page keeps
    // each route's count from including pushes by observers of earlier routes.
    if (scope.__drusnielLongTaskObserver) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) scope.__drusnielLongTasks?.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: false });
      scope.__drusnielLongTaskObserver = observer;
    } catch {
      // Browsers without Long Tasks support report an empty list; the report keeps this explicit.
    }
  });
}

async function readLongTasks(page: Page): Promise<number[]> {
  return await page.evaluate(() => [...((window as typeof window & { __drusnielLongTasks?: number[] }).__drusnielLongTasks ?? [])]);
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
  const boostPreRoute = !sceneName.includes(":post-route");
  let previousBudgets: {
    buildBudgetPagesPerFrame: number;
    applyBudgetPagesPerFrame: number;
    maxInflightBatches: number;
    maxCachedPages: number;
  } | null = null;
  if (boostPreRoute) {
    const restored = await page.evaluate((budgets) => {
      const hooks = (window as typeof window & {
        __drusnielClod?: {
          setAcceptanceSceneOptions?: ((options: {
            streamBudgets?: {
              buildBudgetPagesPerFrame?: number;
              applyBudgetPagesPerFrame?: number;
              maxInflightBatches?: number;
              maxCachedPages?: number;
            };
          }) => {
            buildBudgetPagesPerFrame: number;
            applyBudgetPagesPerFrame: number;
            maxInflightBatches: number;
            maxCachedPages: number;
          } | void) | null;
        };
      }).__drusnielClod;
      const previous = hooks?.setAcceptanceSceneOptions?.({ streamBudgets: budgets });
      if (!previous
        || typeof previous.buildBudgetPagesPerFrame !== "number"
        || typeof previous.applyBudgetPagesPerFrame !== "number"
        || typeof previous.maxInflightBatches !== "number"
        || typeof previous.maxCachedPages !== "number") {
        return null;
      }
      return {
        buildBudgetPagesPerFrame: previous.buildBudgetPagesPerFrame,
        applyBudgetPagesPerFrame: previous.applyBudgetPagesPerFrame,
        maxInflightBatches: previous.maxInflightBatches,
        maxCachedPages: previous.maxCachedPages,
      };
    }, { ...PRE_ROUTE_CONVERGENCE_STREAM_BUDGETS });
    previousBudgets = restored;
    if (previousBudgets) {
      console.log(
        `[infinite-accept] ${sceneName}: pre-route stream budgets ` +
        `${previousBudgets.buildBudgetPagesPerFrame}/${previousBudgets.applyBudgetPagesPerFrame}/${previousBudgets.maxInflightBatches}/cache${previousBudgets.maxCachedPages}` +
        ` -> ${PRE_ROUTE_CONVERGENCE_STREAM_BUDGETS.buildBudgetPagesPerFrame}/${PRE_ROUTE_CONVERGENCE_STREAM_BUDGETS.applyBudgetPagesPerFrame}/${PRE_ROUTE_CONVERGENCE_STREAM_BUDGETS.maxInflightBatches}/cache${PRE_ROUTE_CONVERGENCE_STREAM_BUDGETS.maxCachedPages}`,
      );
    }
  }
  const startedAt = Date.now();
  const deadline = startedAt + CONVERGENCE_TIMEOUT_MS;
  let stablePolls = 0;
  let lastSnapshot = "";
  try {
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
          streamReadyFrame: counters["stream_ready_frame"] ?? -1,
          streamReadyFrontierM: counters["live_clod_stream_ready_frontier_m"] ?? 0,
          farClipmapInnerRadiusM: counters["far_clipmap_inner_radius_m"] ?? 0,
          heightfieldEnabled: counters["heightfield_tiles_enabled"] ?? 0,
          heightfieldPending: counters["heightfield_tiles_pending"] ?? 0,
          heightfieldInflight: counters["heightfield_tiles_inflight"] ?? 0,
          heightfieldFallbackSamples: counters["heightfield_tiles_fallback_samples_this_frame"] ?? 0,
          proxyBuilding: counters["shadow_proxy_building"] ?? -1,
          sceneCompileRequired: counters["scene_compile_warm_required"] ?? 0,
          sceneCompilePending: counters["scene_compile_warm_pending"] ?? 0,
          sceneCompileReady: counters["scene_compile_warm_ready"] ?? 1,
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
    throw new Error(`${sceneName}: convergence wait timed out after ${(CONVERGENCE_TIMEOUT_MS / 1000).toFixed(0)}s`);
  } finally {
    if (previousBudgets) {
      await page.evaluate((budgets) => {
        const hooks = (window as typeof window & {
          __drusnielClod?: {
            setAcceptanceSceneOptions?: ((options: {
              streamBudgets?: {
                buildBudgetPagesPerFrame?: number;
                applyBudgetPagesPerFrame?: number;
                maxInflightBatches?: number;
                maxCachedPages?: number;
              };
            }) => unknown) | null;
          };
        }).__drusnielClod;
        hooks?.setAcceptanceSceneOptions?.({ streamBudgets: budgets });
      }, previousBudgets);
      console.log(
        `[infinite-accept] ${sceneName}: restored stream budgets ` +
        `${previousBudgets.buildBudgetPagesPerFrame}/${previousBudgets.applyBudgetPagesPerFrame}/${previousBudgets.maxInflightBatches}/cache${previousBudgets.maxCachedPages}`,
      );
      await settle(page, BUDGET_RESTORE_SETTLE_FRAMES);
      const drainDeadline = Date.now() + BUDGET_RESTORE_DRAIN_TIMEOUT_MS;
      for (;;) {
        const inflight = await page.evaluate(() => {
          const counters = (window as typeof window & {
            __drusnielClod?: { stats?: { counters?: Record<string, number> } | null };
          }).__drusnielClod?.stats?.counters ?? {};
          return counters["live_clod_stream_inflight_batches"] ?? 0;
        });
        if (inflight <= previousBudgets.maxInflightBatches) break;
        if (Date.now() > drainDeadline) {
          console.log(
            `[infinite-accept] ${sceneName}: stream inflight batches (${inflight}) did not drain to ` +
            `${previousBudgets.maxInflightBatches} within ${(BUDGET_RESTORE_DRAIN_TIMEOUT_MS / 1000).toFixed(0)}s; gates will see the backlog`,
          );
          break;
        }
        await settle(page, BUDGET_RESTORE_SETTLE_FRAMES);
      }
    }
  }
}

async function beginMovementRouteProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hook = (window as typeof window & { __drusnielClod?: { beginMovementRouteProbe?: (() => void) | null } }).__drusnielClod?.beginMovementRouteProbe;
    if (typeof hook !== "function") throw new Error("movement route requires __drusnielClod.beginMovementRouteProbe");
    hook();
  });
}

async function collectRouteGarbageBaseline(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("HeapProfiler.collectGarbage");
  } finally {
    await session.detach();
  }
}

/**
 * Representative coast-to-coast crosses the village landmark mid-route. First-draw of that
 * dense cluster can hitch; visit it once before measurement so pipeline/content warm is
 * outside the gated sample window.
 */
async function prewarmRepresentativeLandmark(page: Page): Promise<void> {
  if (MOVEMENT_CONTENT_PROFILE !== "representative") return;
  if (!MOVEMENT_ROUTE_PROFILE.name.startsWith("coast-to-coast") && MOVEMENT_ROUTE_PROFILE.name !== "continent-short") {
    return;
  }
  const start = MOVEMENT_ROUTE_PROFILE.start ?? [-8_000, 96, 0];
  const startPose = await readAutomationPose(page);
  console.log(
    `[infinite-accept] prewarm: visiting village landmark (${RPG_VILLAGE_CENTER.x}, ${RPG_VILLAGE_CENTER.z}) before measured route`,
  );
  await setAutomationPose(page, {
    ...startPose,
    p: [RPG_VILLAGE_CENTER.x, startPose.p[1], RPG_VILLAGE_CENTER.z],
  });
  await settle(page, 180);
  await setAutomationPose(page, {
    ...startPose,
    p: [start[0], startPose.p[1], start[2]],
  });
  await settle(page, 60);
  // Village hop drains the start bubble; re-converge so the measured route sees ready pages.
  await waitForConvergence(page, "prewarm:return");
}

async function readMovementSnapshot(page: Page, label: string, routeDistanceM: number): Promise<MovementSnapshot> {
  return await page.evaluate(({ sampleLabel, distanceM }) => {
    const hooks = (window as typeof window & { __drusnielClod?: { getPose?: (() => { p: [number, number, number] }) | null; stats?: { counters?: Record<string, number> } | null } }).__drusnielClod;
    const pose = hooks?.getPose?.();
    if (!pose) throw new Error("movement route requires __drusnielClod.getPose");
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    const usedJsHeapBytes = Number(memory?.usedJSHeapSize);
    return JSON.parse(JSON.stringify({
      label: sampleLabel,
      pose: pose.p,
      counters: hooks?.stats?.counters ?? {},
      routeDistanceM: distanceM,
      usedJsHeapBytes: Number.isFinite(usedJsHeapBytes) ? usedJsHeapBytes : null,
    })) as MovementSnapshot;
  }, { sampleLabel: label, distanceM: routeDistanceM });
}

async function readResidencySnapshot(page: Page): Promise<ResidencySnapshot> {
  const snapshot = await page.evaluate(() => window.__drusnielClod?.getStreamingResidencySnapshot?.() ?? null);
  if (!snapshot) throw new Error("revisit route requires __drusnielClod.getStreamingResidencySnapshot");
  return snapshot;
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

async function collectMovementFrames(page: Page, afterFrameId: number, phase: "outbound" | "revisit"): Promise<MovementFrameSample[]> {
  return await page.evaluate(({ after, samplePhase, broadKeys, propKeys, churnKeys }) => {
    const perf = (window as typeof window & { __drusnielPerf?: { recentSamples?: Array<Record<string, unknown>> } }).__drusnielPerf;
    return (perf?.recentSamples ?? []).filter((sample) => Number(sample["frameId"]) > after).map((sample) => {
      const metrics: Record<string, number> = {};
      for (const key of [...broadKeys, ...propKeys, ...churnKeys]) {
        const value = Number(sample[key]);
        metrics[key] = Number.isFinite(value) ? value : 0;
      }
      return {
        frameId: Number(sample["frameId"]),
        frameMs: Number(sample["frameMs"]),
        renderMs: Number(sample["renderMs"]),
        phase: samplePhase,
        metrics,
      };
    });
  }, {
    after: afterFrameId,
    samplePhase: phase,
    broadKeys: FRAME_PERF_BROAD_BUCKETS,
    propKeys: FRAME_PERF_PROP_BUCKETS,
    churnKeys: FRAME_PERF_MATERIAL_CHURN_BUCKETS,
  });
}

async function waitForRegionDrain(
  page: Page,
  frameSamples: MovementFrameSample[],
  frameCursor: { lastFrameId: number },
  phase: "outbound" | "revisit",
): Promise<void> {
  for (let waitedFrames = 0; waitedFrames < MOVEMENT_ROUTE_PROFILE.maxRegionDrainFrames; waitedFrames += MOVEMENT_SAMPLE_FRAMES) {
    const drained = await page.evaluate(() => {
      const counters = window.__drusnielClod?.stats?.counters ?? {};
      return (counters["heightfield_tiles_fallback_samples_this_frame"] ?? 0) === 0
        && (counters["heightfield_tiles_pending"] ?? 0) === 0
        && (counters["heightfield_tiles_inflight"] ?? 0) === 0
        && (counters["live_clod_stream_safety_pending_pages"] ?? 0) === 0
        && (counters["live_clod_stream_safety_inflight_pages"] ?? 0) === 0;
    });
    if (drained) return;
    await settle(page, MOVEMENT_SAMPLE_FRAMES);
    const nextFrames = await collectMovementFrames(page, frameCursor.lastFrameId, phase);
    frameSamples.push(...nextFrames);
    frameCursor.lastFrameId = frameSamples.at(-1)?.frameId ?? frameCursor.lastFrameId;
  }
}

async function runMovementSegment(
  page: Page,
  segment: MovementSegment,
  snapshots: MovementSnapshot[],
  frameSamples: MovementFrameSample[],
  frameCursor: { lastFrameId: number },
  startRouteDistanceM: number,
): Promise<number> {
  const start = await readAutomationPose(page);
  const target: CamPose = { ...start, p: [start.p[0] + segment.dx, start.p[1], start.p[2] + segment.dz] };
  const segmentDistanceM = Math.hypot(segment.dx, segment.dz);
  const phase = segment.phase ?? "outbound";
  let elapsedFrames = 0;
  let sampleIndex = 0;
  while (elapsedFrames < segment.frames) {
    const frames = Math.min(MOVEMENT_SAMPLE_FRAMES, segment.frames - elapsedFrames);
    elapsedFrames += frames;
    const t = elapsedFrames / segment.frames;
    await setAutomationPose(page, { ...start, p: [start.p[0] + (target.p[0] - start.p[0]) * t, start.p[1], start.p[2] + (target.p[2] - start.p[2]) * t] });
    await settle(page, frames);
    const nextFrames = await collectMovementFrames(page, frameCursor.lastFrameId, phase);
    frameSamples.push(...nextFrames);
    frameCursor.lastFrameId = frameSamples.at(-1)?.frameId ?? frameCursor.lastFrameId;
    snapshots.push(await readMovementSnapshot(page, `${segment.label}:${sampleIndex}`, startRouteDistanceM + segmentDistanceM * t));
    sampleIndex++;
  }
  await waitForRegionDrain(page, frameSamples, frameCursor, phase);
  snapshots.push(await readMovementSnapshot(page, `${segment.label}:settled`, startRouteDistanceM + segmentDistanceM));
  return startRouteDistanceM + segmentDistanceM;
}

async function runMovementRoute(page: Page): Promise<MovementReport> {
  const samples: MovementSnapshot[] = [];
  const frameSamples: MovementFrameSample[] = [];
  const frameCursor = { lastFrameId: -1 };
  await prewarmRepresentativeLandmark(page);
  await collectRouteGarbageBaseline(page);
  await beginMovementRouteProbe(page);
  await startLongTaskObserver(page);
  frameCursor.lastFrameId = await page.evaluate(() => Number((window as typeof window & {
    __drusnielPerf?: { lastSample?: { frameId?: number } | null };
  }).__drusnielPerf?.lastSample?.frameId ?? -1));
  samples.push(await readMovementSnapshot(page, "start", 0));
  const routeAResidency = MOVEMENT_ROUTE_PROFILE.name === "coast-to-coast-revisit"
    ? await readResidencySnapshot(page)
    : null;
  let beforeReturnResidency: ResidencySnapshot | null = null;
  let routeDistanceM = 0;
  for (const segment of WALK_ROUTE) {
    if (segment.phase === "revisit" && beforeReturnResidency === null) {
      beforeReturnResidency = await readResidencySnapshot(page);
    }
    routeDistanceM = await runMovementSegment(page, segment, samples, frameSamples, frameCursor, routeDistanceM);
  }
  const start = samples[0]!.pose;
  const end = samples.at(-1)!.pose;
  const worldCells = maxCounter(samples, "world_cells");
  const frameTimes = frameSamples.map((sample) => sample.frameMs).filter(Number.isFinite);
  const renderTimes = frameSamples.map((sample) => sample.renderMs).filter(Number.isFinite);
  const frameSummary = summarizeFrameTimes(frameTimes);
  const frontierLagSamples = samples.map((sample) => {
    const innerRadiusM = sample.counters["far_clipmap_inner_radius_m"];
    const frontierM = sample.counters["live_clod_stream_ready_frontier_m"];
    return Number.isFinite(innerRadiusM) && Number.isFinite(frontierM)
      ? Math.max(0, innerRadiusM! - frontierM!)
      : Number.NaN;
  }).filter(Number.isFinite);
  const warmHeapSamples = samples.slice(Math.floor(samples.length * 0.2)).filter(
    (sample): sample is MovementSnapshot & { usedJsHeapBytes: number } => sample.usedJsHeapBytes !== null,
  );
  const heapValues = warmHeapSamples.map((sample) => sample.usedJsHeapBytes);
  const settledSamples = samples.filter((sample) => sample.label.endsWith(":settled"));
  const revisitStartIndex = samples.findIndex((sample) => sample.label.startsWith("revisit-east-to-interior:0"));
  const revisitStart = revisitStartIndex > 0 ? samples[revisitStartIndex - 1]! : null;
  const revisitEnd = revisitStart ? samples.at(-1)! : null;
  const outboundFrames = frameSamples.filter((sample) => sample.phase === "outbound");
  const revisitFrames = frameSamples.filter((sample) => sample.phase === "revisit");
  const outboundP99 = percentile(outboundFrames.map((sample) => sample.frameMs), 0.99);
  const revisitP99 = percentile(revisitFrames.map((sample) => sample.frameMs), 0.99);
  const outboundFrameMs = summarizeFrameTimes(outboundFrames.map((sample) => sample.frameMs));
  const revisitFrameMs = summarizeFrameTimes(revisitFrames.map((sample) => sample.frameMs));
  const longTasks = await readLongTasks(page);
  const revisitEviction = routeAResidency && beforeReturnResidency
    ? evaluateRevisitEviction(routeAResidency, beforeReturnResidency)
    : null;
  const revisitEconomics: RevisitEconomics | null = revisitStart && revisitEnd ? {
    clodPageBuilds: Math.max(0, numCounter(revisitEnd.counters, "live_clod_stream_built_total") - numCounter(revisitStart.counters, "live_clod_stream_built_total")),
    clodBuildMs: revisitFrames.reduce((sum, sample) => sum + (sample.metrics["clodApplyMs"] ?? 0), 0),
    farSummaryTileBuilds: Math.max(0, numCounter(revisitEnd.counters, "far_summary_tiles_built_total") - numCounter(revisitStart.counters, "far_summary_tiles_built_total")),
    farSummaryBuildMs: revisitFrames.reduce((sum, sample) => sum + (sample.metrics["farSummaryMs"] ?? 0), 0),
    heightfieldTileBuilds: Math.max(0, numCounter(revisitEnd.counters, "heightfield_tiles_builds_total") - numCounter(revisitStart.counters, "heightfield_tiles_builds_total")),
    heightfieldStoreHits: Math.max(0, numCounter(revisitEnd.counters, "heightfield_tiles_store_hits") - numCounter(revisitStart.counters, "heightfield_tiles_store_hits")),
    heightfieldStoreMisses: Math.max(0, numCounter(revisitEnd.counters, "heightfield_tiles_store_misses") - numCounter(revisitStart.counters, "heightfield_tiles_store_misses")),
    outboundFrameP99Ms: outboundP99,
    revisitFrameP99Ms: revisitP99,
    frameP99DeltaMs: revisitP99 - outboundP99,
    outboundFrameMs,
    revisitFrameMs,
  } : null;
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
    liveBubbleEvictionsDelta: counterDelta(samples, "live_bubble_evictions_total"),
    maxStreamCachedPages: maxCounter(samples, "live_clod_stream_cached_pages"),
    maxStreamApplyPagesThisFrame: maxCounter(samples, "live_clod_stream_apply_pages_this_frame"),
    streamApplyPagesDelta: counterDelta(samples, "live_clod_stream_apply_pages_total"),
    maxStreamEvictions: maxCounter(samples, "live_clod_stream_evictions"),
    maxStreamStaleDiscards: maxCounter(samples, "live_clod_stream_stale_discards"),
    streamEvictionsDelta: counterDelta(samples, "live_clod_stream_evictions_total"),
    streamStaleDiscardsDelta: counterDelta(samples, "live_clod_stream_stale_discards_total"),
    frameSampleCount: frameSummary.sampleCount,
    frameP50Ms: frameSummary.p50Ms,
    frameP95Ms: frameSummary.p95Ms,
    frameP99Ms: frameSummary.p99Ms,
    frameP999Ms: frameSummary.p999Ms,
    renderP95Ms: percentile(renderTimes, 0.95),
    maxFrameMs: frameSummary.maxMs,
    framesOver16_7Ms: frameSummary.over16_7,
    framesOver33_3Ms: frameSummary.over33_3,
    framesOver100Ms: frameSummary.over100,
    longTaskCount: longTasks.length,
    longestLongTaskMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
    topPhaseBucket: topBucket(frameSamples, FRAME_PERF_BROAD_BUCKETS),
    topPropBucket: topBucket(frameSamples, FRAME_PERF_PROP_BUCKETS),
    maxWorkUnitMs: maxCounter(samples, "live_bubble_probe_cpu_work_unit_max_ms"),
    maxPriorityUnownedCells: maxCounter(samples, "priority_unowned_cells"),
    maxClodFarGapHoles: maxCounter(samples, "clod_far_gap_holes"),
    maxFarClipmapOwnershipHoles: maxCounter(samples, "far_clipmap_ownership_holes"),
    frontierLagSampleCount: frontierLagSamples.length,
    frontierLagP95M: percentile95(frontierLagSamples),
    maxHeightfieldFallbackSamples: maxCounter(samples, "heightfield_tiles_fallback_samples_this_frame"),
    maxSettledHeightfieldFallbackSamples: maxCounter(settledSamples, "heightfield_tiles_fallback_samples_this_frame"),
    heapEnvelopeAfterWarmup: summarizeNumericEnvelope(heapValues),
    resourceEnvelopes: resourceEnvelopes(samples),
    revisitEviction,
    revisitEconomics,
    worstFrames: worstMovementFrames(frameSamples),
    samples,
  };
}

function evaluateMovementRoute(sceneName: string, movement: MovementReport | null): string[] {
  if (!movement) return [];
  const failures: string[] = [];
  if (movement.horizontalDistanceM < MOVEMENT_ROUTE_PROFILE.minHorizontalDistanceM) failures.push(`${sceneName}: movement route distance ${movement.horizontalDistanceM.toFixed(2)}m < ${MOVEMENT_ROUTE_PROFILE.minHorizontalDistanceM}m`);
  if (!movement.startedOutsideStartupWorld) failures.push(`${sceneName}: movement route did not start outside startup world`);
  if (!movement.endedOutsideStartupWorld) failures.push(`${sceneName}: movement route did not end outside startup world`);
  if (movement.maxLiveBubbleReadyPages <= 0) failures.push(`${sceneName}: movement route never observed ready live-bubble pages`);
  if (movement.liveBubbleBuiltDelta <= 0) failures.push(`${sceneName}: movement route never built a live-bubble page during motion`);
  if (movement.maxStreamCachedPages <= 0) failures.push(`${sceneName}: movement route never observed cached streamed CLOD roots`);
  if (movement.streamApplyPagesDelta <= 0 && movement.maxStreamApplyPagesThisFrame <= 0) {
    failures.push(`${sceneName}: movement route never applied streamed CLOD roots during motion`);
  }
  if (movement.streamEvictionsDelta + movement.streamStaleDiscardsDelta <= 0) failures.push(`${sceneName}: movement route never exercised streamed CLOD eviction or stale-discard paths`);
  if (movement.liveBubbleEvictionsDelta > MOVEMENT_ROUTE_PROFILE.maxLiveBubbleEvictions) failures.push(`${sceneName}: movement live-bubble evictions ${movement.liveBubbleEvictionsDelta} > ${MOVEMENT_ROUTE_PROFILE.maxLiveBubbleEvictions}`);
  if (movement.streamEvictionsDelta > MOVEMENT_ROUTE_PROFILE.maxStreamEvictions) failures.push(`${sceneName}: movement streamed-CLOD evictions ${movement.streamEvictionsDelta} > ${MOVEMENT_ROUTE_PROFILE.maxStreamEvictions}`);
  if (MOVEMENT_ROUTE_PROFILE.name.startsWith("coast-to-coast") && movement.maxSettledHeightfieldFallbackSamples !== 0) {
    failures.push(`${sceneName}: heightfield fallback samples did not return to zero after every route region (max ${movement.maxSettledHeightfieldFallbackSamples})`);
  }
  if (MOVEMENT_ROUTE_PROFILE.name === "coast-to-coast-revisit") {
    if (!movement.revisitEviction) failures.push(`${sceneName}: revisit route did not capture pre-return residency evidence`);
    else failures.push(...movement.revisitEviction.failures.map((failure) => `${sceneName}: ${failure}`));
  }
  if (ROUTE_TAIL_THRESHOLDS && MOVEMENT_ROUTE_PROFILE.name !== "coast-to-coast-revisit") {
    failures.push(...evaluateContinentRouteTails({
      frameP50Ms: movement.frameP50Ms,
      frameP95Ms: movement.frameP95Ms,
      frameP99Ms: movement.frameP99Ms,
      frameP999Ms: movement.frameP999Ms,
      maxFrameMs: movement.maxFrameMs,
      framesOver16_7Ms: movement.framesOver16_7Ms,
      framesOver33_3Ms: movement.framesOver33_3Ms,
      longTaskCount: movement.longTaskCount,
      longestLongTaskMs: movement.longestLongTaskMs,
      topPhaseP95Ms: movement.topPhaseBucket?.p95Ms ?? Number.NaN,
      topPhaseMaxMs: movement.topPhaseBucket?.maxMs ?? Number.NaN,
    }, ROUTE_TAIL_THRESHOLDS).map((failure) => `${sceneName}: ${failure}`));
  }
  if (movement.framesOver100Ms !== 0) failures.push(`${sceneName}: movement had ${movement.framesOver100Ms} frame(s) over 100ms after warmup; expected zero`);
  failures.push(...evaluateMovementPerformance(sceneName, movement, {
    minFrameSamples: MOVEMENT_ROUTE_PROFILE.minFrameSamples,
    maxFrameP99Ms: MAX_ROUTE_FRAME_P99_MS,
    maxFrameMs: MAX_ROUTE_FRAME_MS,
    maxWorkUnitMs: MAX_ROUTE_WORK_UNIT_MS,
  }));
  failures.push(...evaluateMovementCoverage(sceneName, movement, {
    minFrontierLagSamples: movement.samples.length,
    maxFrontierLagP95M: MOVEMENT_ROUTE_PROFILE.maxFrontierLagP95M,
  }));
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

function evaluateSceneSpecificCounters(
  scene: SceneSpec,
  stats: JsonRecord,
  startupTimings: Readonly<Record<string, number>>,
): string[] {
  if (scene.validation === "stone-gpu") return evaluateStoneGpuCounters(stats);
  if (scene.validation === "phase6-canopy") return evaluatePhase6CanopyCounters(stats);
  if (scene.validation === "far-summary-gpu-authoritative") return evaluateFarSummaryGpuAuthoritativeCounters(stats);
  if (scene.validation === "water") {
    return evaluateWaterAcceptance({ counters: numericCounters(stats), startupTimings });
  }
  return [];
}

function shouldSkipGenericConvergence(scene: SceneSpec): boolean {
  return scene.validation === "stone-gpu" || scene.validation === "far-summary-gpu-authoritative";
}

function failedImageSanity(message = "screenshot was not captured"): ImageSanityResult {
  return { passed: false, failures: [message], width: 0, height: 0, meanLuma: 0, rgbStddev: 0, meanAlpha: 0 };
}

async function runScene(page: Page, scene: SceneSpec, gate: GateMode, outDir: string, options: RunSceneOptions): Promise<SceneResult> {
  // Scene presets apply at page boot. Water must boot with water=1, and the
  // representative route must boot its RPG composition instead of reusing the
  // infrastructure world.
  const needsDedicatedPage = scene.waterAcceptance === true
    || requiresDedicatedMovementPage(MOVEMENT_ROUTE_PROFILE, scene.movementRoute === true);
  const isolatedPage = options.reusePage && !options.firstSceneOnPage && needsDedicatedPage;
  if (isolatedPage) {
    // The reused page's context was created implicitly by browser.newPage() and
    // cannot spawn more pages; open a fresh context from the browser instead.
    const owner = page.context().browser();
    if (!owner) throw new Error("isolated acceptance page requires a browser handle");
    page = await createAcceptancePage(owner);
    options = { ...options, reusePage: false, firstSceneOnPage: true };
  }
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
  let waterAcceptance: WaterAcceptanceEvidence | null = null;

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
  const routeStart = scene.movementRoute ? MOVEMENT_ROUTE_PROFILE.start : undefined;
  const routeStartExtra: Record<string, string> = routeStart
    ? { x: String(routeStart[0]), z: String(routeStart[2]), yaw: "1.5708" }
    : {};
  const movementSceneParams = scene.movementRoute ? MOVEMENT_ROUTE_PROFILE.sceneParams : {};
  const extra: Record<string, string> = { acceptance: "1", acceptanceReuse: PROFILE, acceptanceReuseMode: String(REUSE_MODE_CODES[PROFILE]), ownershipOracle: gate.ownershipOracle, world: "16", clodPerf: "1", webgpuSelection: "1", ...UNIFIED_STREAMING_ACCEPTANCE_PARAMS, ...profileAcceptanceParams(PROFILE), ...(scene.extra ?? {}), ...movementSceneParams, ...routeStartExtra };
  if (PROFILE === "fast") {
    extra["startupWorld"] = FAST_STARTUP_WORLD;
    extra["infiniteStartupWorld"] = FAST_STARTUP_WORLD;
  }
  if (scene.proceduralDebug) extra["proceduralDebug"] = scene.proceduralDebug;
  const url = clodUrl({ scene: sceneForMovementCase(MOVEMENT_ROUTE_PROFILE, scene.movementRoute === true), seed: 1, hud: true, freeze: scene.freeze, cam: scene.cam, extra });

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
      console.log(
        `[infinite-accept] ${sceneRunName}: movement ${movement.frameSampleCount}f ` +
        `p99=${movement.frameP99Ms.toFixed(2)}ms max=${movement.maxFrameMs.toFixed(2)}ms ` +
        `workMax=${movement.maxWorkUnitMs.toFixed(2)}ms`,
      );
      if (movementPath) writeJson(movementPath, movement);
      await failOnPageError(page, scene.name, pageErrors, failedPath);
      await Promise.race([waitForConvergence(page, `${sceneRunName}:post-route`), pageErrorGate]);
      await failOnPageError(page, scene.name, pageErrors, failedPath);
    }
    if (scene.waterAcceptance) {
      waterAcceptance = await Promise.race([
        captureWaterAcceptance(page, outDir, sceneRunName),
        pageErrorGate,
      ]);
      await failOnPageError(page, scene.name, pageErrors, failedPath);
    }
    await Promise.race([settle(page, WARMUP_FRAMES), pageErrorGate]);
    await resetAcceptanceSampleWindow(page);
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
    const acceptanceCounters = withSampledPerfCounters(extractAcceptanceCounters(stats), phase0);
    const activeRules = MOVEMENT_CONTENT_PROFILE === "representative" && scene.movementRoute && gate.name === "perf"
      ? withFrameMsP95Max(gate.rules, RPG_DENSE_PRIMARY_TIER.villageSettledFrameMsP95Max)
      : gate.rules;
    const thresholds: ThresholdEvaluation = scene.validation
      ? evaluateThresholds(acceptanceCounters, [], [])
      : evaluateThresholds(acceptanceCounters, gate.requiredCounters, activeRules);
    const movementFailures = evaluateMovementRoute(scene.name, movement);
    const sceneSpecificFailures = evaluateSceneSpecificCounters(scene, stats, finalStartupTimings);
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
      waterAcceptance,
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
      waterAcceptance,
      failures,
      passed: false,
    };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    if (isolatedPage) await page.close().catch(() => undefined);
  }
}

async function runAcceptanceScenes(browser: Browser, outDir: string): Promise<SceneResult[]> {
  const sceneResults: SceneResult[] = [];
  if (PROFILE === "reuse") {
    const page = await createAcceptancePage(browser);
    let firstSceneOnPage = true;
    try {
      for (const gate of ACTIVE_GATES) {
        for (const scene of ACTIVE_SCENES) {
          if (!sceneSupportsGate(scene, gate)) continue;
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
        if (!sceneSupportsGate(scene, gate)) continue;
        const page = await createAcceptancePage(browser);
        try {
          sceneResults.push(await runScene(page, scene, gate, outDir, { reusePage: false, firstSceneOnPage: true }));
        } finally {
          await page.close().catch(() => undefined);
        }
      }
    }
  }
  return sceneResults;
}

function writeAcceptanceReport(input: {
  outDir: string;
  timestamp: string;
  browserVersion: string;
  recipe: unknown;
  sceneResults: SceneResult[];
  runIndex?: number;
  repeatCount?: number;
}): { reportJsonPath: string; reportMdPath: string; passed: boolean; runtimePassed: boolean; failures: string[] } {
  const { outDir, timestamp, browserVersion, recipe, sceneResults } = input;
  const runtimeFailures = sceneResults.flatMap((scene) => scene.failures.map((failure) => `${scene.name}: ${failure}`));
  const runtimePassed = aggregatePassed(sceneResults, runtimeFailures);
  const failures = ROUTE_CALIBRATION
    ? [...runtimeFailures, "calibration-only capture; five-run thresholds are not frozen"]
    : runtimeFailures;
  const passed = runtimePassed && !ROUTE_CALIBRATION;
  const reportJsonPath = resolve(outDir, "report.json");
  const reportMdPath = resolve(outDir, "report.md");
  const firstStartupTimings = sceneResults[0]?.startupTimings ?? {};
  const report = {
    passed,
    timestamp,
    commit_sha: gitSha(),
    browser_launch_recipe: recipe,
    repeat_index: input.runIndex ?? 1,
    repeat_count: input.repeatCount ?? 1,
    environment: {
      ...hostEnvironmentRecord(),
      browser_version: browserVersion,
      capture_viewport: { width: WIDTH, height: HEIGHT, device_scale_factor: 1 },
      cache_state: PROFILE === "reuse" ? "reuse-profile; per-scene hit/miss recorded below" : "fresh page per scene; per-scene hit/miss recorded below",
    },
    profile: PROFILE,
    movement_route_profile: MOVEMENT_ROUTE_PROFILE.name,
    movement_content_profile: MOVEMENT_ROUTE_PROFILE.contentProfile,
    unified_streaming_baseline: UNIFIED_STREAMING_ACCEPTANCE_PARAMS,
    route_tail_thresholds: ROUTE_TAIL_THRESHOLDS,
    route_tail_thresholds_path: CONTINENT_ROUTE ? rel(ROUTE_THRESHOLDS_PATH) : null,
    calibration_only: ROUTE_CALIBRATION,
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
      water_acceptance: scene.waterAcceptance,
      artifacts: {
        screenshot: scene.screenshot,
        stats_json: scene.statsPath,
        phase0_report_json: scene.phase0Path,
        qa_summary_json: scene.summaryPath,
        visual_comparison: scene.comparisonPath,
        water_shots: scene.waterAcceptance?.shots ?? null,
      },
    })),
    artifacts: { run_dir: rel(outDir), report_json: rel(reportJsonPath), report_md: rel(reportMdPath) },
  };
  writeJson(reportJsonPath, report);
  writeFileSync(reportMdPath, renderMarkdownReport({ passed, scenes: sceneResults, failures, reportJsonPath: rel(reportJsonPath) }));
  return { reportJsonPath, reportMdPath, passed, runtimePassed, failures };
}

function movementTailSummary(sceneResults: SceneResult[]): Record<string, number | null> | null {
  const movement = sceneResults.find((scene) => scene.movement)?.movement;
  if (!movement) return null;
  return {
    frameP50Ms: movement.frameP50Ms ?? null,
    frameP95Ms: movement.frameP95Ms ?? null,
    frameP99Ms: movement.frameP99Ms ?? null,
    maxFrameMs: movement.maxFrameMs ?? null,
    framesOver16_7Ms: movement.framesOver16_7Ms ?? null,
    framesOver33_3Ms: movement.framesOver33_3Ms ?? null,
  };
}

async function main(): Promise<void> {
  const timestamp = timestampForFolder();
  const requestedOutDir = cliValues(CLI_ARGS, "--out").at(-1);
  const outDir = requestedOutDir ? resolve(requestedOutDir) : resolve(RUN_ROOT, timestamp);
  mkdirSync(outDir, { recursive: true });
  console.log(`[infinite-accept] run ${rel(outDir)}`);
  console.log(`[infinite-accept] base ${process.env["CLOD_POC_BASE_URL"]}`);
  console.log(`[infinite-accept] profile ${PROFILE} route=${MOVEMENT_ROUTE_PROFILE.name} content=${MOVEMENT_ROUTE_PROFILE.contentProfile} gates=${ACTIVE_GATES.map((gate) => gate.name).join(",")} scenes=${ACTIVE_SCENES.map((scene) => scene.name).join(",")} sampleFrames=${SAMPLE_FRAMES} repeat=${REPEAT_COUNT}`);
  const { browser, recipe } = await launchWebGPU();
  const browserVersion = browser.version();
  const repeatSummaries: Array<{
    run: number;
    outDir: string;
    runtimePassed: boolean;
    wallMs: number;
    movement: Record<string, number | null> | null;
    failures: string[];
  }> = [];
  let anyRuntimeFailed = false;
  try {
    for (let run = 1; run <= REPEAT_COUNT; run++) {
      const runOutDir = REPEAT_COUNT > 1 ? resolve(outDir, `run-${run}`) : outDir;
      mkdirSync(runOutDir, { recursive: true });
      if (REPEAT_COUNT > 1) console.log(`[infinite-accept] repeat ${run}/${REPEAT_COUNT} -> ${rel(runOutDir)}`);
      const runStartedAt = Date.now();
      // Fresh context+page per repeat (Playwright newPage creates a new context).
      const sceneResults = await runAcceptanceScenes(browser, runOutDir);
      const wallMs = Date.now() - runStartedAt;
      const written = writeAcceptanceReport({
        outDir: runOutDir,
        timestamp,
        browserVersion,
        recipe,
        sceneResults,
        runIndex: run,
        repeatCount: REPEAT_COUNT,
      });
      console.log(`[infinite-accept] report ${rel(written.reportJsonPath)} wall=${(wallMs / 1000).toFixed(1)}s`);
      if (!written.runtimePassed) anyRuntimeFailed = true;
      repeatSummaries.push({
        run,
        outDir: rel(runOutDir),
        runtimePassed: written.runtimePassed,
        wallMs,
        movement: movementTailSummary(sceneResults),
        failures: written.failures,
      });
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  if (REPEAT_COUNT > 1) {
    const run1 = repeatSummaries[0]?.movement;
    const later = repeatSummaries.slice(1).map((entry) => entry.movement).filter(Boolean) as Array<Record<string, number | null>>;
    const run1P95 = typeof run1?.frameP95Ms === "number" ? run1.frameP95Ms : null;
    const laterP95 = later.map((entry) => entry.frameP95Ms).filter((value): value is number => typeof value === "number");
    const laterP95Mean = laterP95.length > 0 ? laterP95.reduce((sum, value) => sum + value, 0) / laterP95.length : null;
    const run1Skew = run1P95 !== null && laterP95Mean !== null && run1P95 > laterP95Mean * 1.15;
    const repeatSummary = {
      repeat_count: REPEAT_COUNT,
      run1_dawn_skew_suspected: run1Skew,
      note: run1Skew
        ? "Run 1 frameP95 is >15% above later-run mean; keep fresh-browser-per-repeat as fallback if skew persists."
        : "Run 1 vs later-run frame tails look consistent under fresh context+page per repeat.",
      runs: repeatSummaries,
    };
    writeJson(resolve(outDir, "repeat-summary.json"), repeatSummary);
    console.log(`[infinite-accept] repeat-summary ${rel(resolve(outDir, "repeat-summary.json"))} run1Skew=${run1Skew}`);
  }

  if (anyRuntimeFailed && !ROUTE_CALIBRATION) {
    console.error(`[infinite-accept] FAILED with runtime failure(s)`);
    process.exit(1);
  }
  if (ROUTE_CALIBRATION) {
    console.log("[infinite-accept] calibration captured; this report is deliberately not proof");
    if (anyRuntimeFailed) {
      console.warn("[infinite-accept] calibration runs included runtime failures; inspect repeat-summary before freezing thresholds");
      process.exit(1);
    }
    return;
  }
  console.log("[infinite-accept] ok");
}

main().catch((error: unknown) => {
  console.error("[infinite-accept] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
