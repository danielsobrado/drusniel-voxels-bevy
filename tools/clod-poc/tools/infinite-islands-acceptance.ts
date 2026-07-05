import { chromium, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { evaluateThresholds, extractAcceptanceCounters } from "./infinite_acceptance/thresholds.js";

const BASE_URL = process.env.CLOD_POC_BASE_URL ?? "http://127.0.0.1:5173/";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
const OUT_DIR = path.resolve("acceptance-runs/infinite-islands", RUN_ID);
const WARMUP_FRAMES = 30;
const SAMPLE_FRAMES = 240;
const SETTLE_TIMEOUT_MS = 120_000;
const CONVERGENCE_TIMEOUT_MS = 120_000;
const CONVERGENCE_POLL_MS = 500;
const CONVERGENCE_STABLE_POLLS = 3;
const RING_STRESS_FRAMES = 120;
const MOVEMENT_SAMPLE_INTERVAL_FRAMES = 30;
const MOVEMENT_ROUTE = [
  { forward: true, frames: 90 },
  { right: true, frames: 90 },
  { backward: true, frames: 90 },
  { left: true, frames: 90 },
] as const;
const SCENES = [
  {
    name: "walk",
    query:
      "?scene=infinite-islands&seed=1&cam=2048%2C96%2C2048%2C2.6500%2C-0.4300%2C55&hud=1&acceptance=1&world=16&clodPerf=1&webgpuSelection=1&x=2048&z=2048&yaw=2.65&liveClodRootBudget=2&liveClodRootMaxCached=4&proceduralDebug=biome",
    movement: true,
  },
  {
    name: "biome-near",
    query:
      "?scene=infinite-islands&seed=1&cam=2048%2C96%2C2048%2C2.6500%2C-0.4300%2C55&hud=1&freeze=1&acceptance=1&world=16&clodPerf=1&webgpuSelection=1&proceduralDebug=biome",
  },
  {
    name: "biome-horizon",
    query:
      "?scene=infinite-islands&seed=1&cam=2048%2C120%2C2048%2C2.6500%2C-0.1800%2C55&hud=1&freeze=1&acceptance=1&world=16&clodPerf=1&webgpuSelection=1&proceduralDebug=biome",
  },
  {
    name: "hydrology-near",
    query:
      "?scene=infinite-islands&seed=1&cam=2048%2C96%2C2048%2C2.6500%2C-0.4300%2C55&hud=1&freeze=1&acceptance=1&world=16&clodPerf=1&webgpuSelection=1&proceduralDebug=hydrology",
  },
  {
    name: "hydrology-horizon",
    query:
      "?scene=infinite-islands&seed=1&cam=2048%2C120%2C2048%2C2.6500%2C-0.1800%2C55&hud=1&freeze=1&acceptance=1&world=16&clodPerf=1&webgpuSelection=1&proceduralDebug=hydrology",
  },
] as const;

interface MovementSnapshot {
  label: string;
  counters: Record<string, number>;
  pose: { x: number; y: number; z: number; yaw: number; pitch: number } | null;
}

interface MovementReport {
  samples: MovementSnapshot[];
  horizontalDistanceM: number;
  maxLiveBubbleReadyPages: number;
  maxStreamCachedPages: number;
  liveBubbleBuiltDelta: number;
  streamRequestedPagesDelta: number;
  streamApplyPagesDelta: number;
  streamEvictionsDelta: number;
  streamStaleDiscardsDelta: number;
  failures: string[];
}

function sceneUrl(query: string): string {
  return new URL(query, BASE_URL).toString();
}

async function mkdirp(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function waitForStatsReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hooks = (window as typeof window & { __drusnielClod?: { ready?: boolean; error?: string | null } }).__drusnielClod;
    if (hooks?.error) throw new Error(hooks.error);
    return hooks?.ready === true;
  }, undefined, { timeout: SETTLE_TIMEOUT_MS });
}

async function settlePage(page: Page, frames: number, timeoutMs: number): Promise<void> {
  await page.evaluate(({ frames: frameCount, timeoutMs: timeout }) => new Promise<void>((resolve, reject) => {
    const hooks = (window as typeof window & { __drusnielClod?: { settle?: (frames: number) => Promise<void> } }).__drusnielClod;
    if (!hooks?.settle) {
      reject(new Error("missing __drusnielClod.settle hook"));
      return;
    }
    const timer = window.setTimeout(() => reject(new Error(`settle timeout after ${timeout}ms`)), timeout);
    hooks.settle(frameCount).then(() => {
      window.clearTimeout(timer);
      resolve();
    }, (error) => {
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  }), { frames, timeoutMs });
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
      const counters = (window as typeof window & {
        __drusnielClod?: { stats?: { counters?: Record<string, number> } | null };
      }).__drusnielClod?.stats?.counters ?? {};
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
        bubbleColliderPages: counters["live_bubble_streamed_collider_pages"] ?? -1,
        bubbleColliderRegistrations: counters["live_bubble_collider_registrations"] ?? -1,
        streamRequired: counters["live_clod_stream_required_pages"] ?? 0,
        streamPending: counters["live_clod_stream_pending_pages"] ?? 0,
        streamInflight: counters["live_clod_stream_inflight_batches"] ?? 0,
        streamReady: counters["live_clod_stream_ready_pages"] ?? 0,
        streamCached: counters["live_clod_stream_cached_pages"] ?? 0,
        streamFailed: counters["live_clod_stream_failed_pages"] ?? 0,
        proxyBuilding: counters["shadow_proxy_building"] ?? -1,
      };
    });
    const farSummaryQuiet = c.tilesMissing === 0 && c.tilesBuilding === 0;
    const shellQuiet = c.farShellRebuildPending === 0;
    const textureQuiet = c.textureWindowPending === 0;
    const bubbleQuiet = c.bubbleRequired === 0 || (
      c.bubbleFailed === 0
      && c.bubbleRetryPages === 0
      && c.bubbleBuilding === 0
      && c.bubbleReady > 0
    );
    const streamQuiet = c.streamRequired === 0 || (
      c.streamFailed === 0
      && c.streamCached > 0
    );
    const quiet = farSummaryQuiet && shellQuiet && textureQuiet && bubbleQuiet && streamQuiet && c.proxyBuilding !== 1;
    stablePolls = quiet ? stablePolls + 1 : 0;
    if (stablePolls >= CONVERGENCE_STABLE_POLLS) {
      console.log(`[infinite-accept] ${sceneName}: converged after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      return;
    }
    lastSnapshot = JSON.stringify(c);
    await page.waitForTimeout(CONVERGENCE_POLL_MS);
  }
  console.log(`[infinite-accept] ${sceneName}: convergence wait timed out after ${(CONVERGENCE_TIMEOUT_MS / 1000).toFixed(0)}s; last ${lastSnapshot}`);
}

async function beginMovementRouteProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hook = (window as typeof window & {
      __drusnielClod?: { beginMovementRouteProbe?: (() => void) | null };
    }).__drusnielClod?.beginMovementRouteProbe;
    if (typeof hook !== "function") {
      throw new Error("movement route requires __drusnielClod.beginMovementRouteProbe");
    }
    hook();
  });
}

async function readMovementSnapshot(page: Page, label: string): Promise<MovementSnapshot> {
  return await page.evaluate((sampleLabel) => {
    const hooks = (window as typeof window & { __drusnielClod?: {
      stats?: { counters?: Record<string, number> };
      getPose?: (() => { x: number; y: number; z: number; yaw: number; pitch: number }) | null;
    } }).__drusnielClod;
    return {
      label: sampleLabel,
      counters: { ...(hooks?.stats?.counters ?? {}) },
      pose: hooks?.getPose?.() ?? null,
    };
  }, label);
}
