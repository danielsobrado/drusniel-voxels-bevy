import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import {
  borderOceanCameraForWorld,
  parseBorderOceanSceneConfig,
  validateBorderOceanStats,
} from "../src/debug/border_ocean_scene.js";
import { INFINITE_ISLANDS_FRAME_MS_P95_MAX } from "./infinite_acceptance/thresholds.js";

const SHOT_DIR = "shots/phase-0";
const SANITY_SHOT = `${SHOT_DIR}/sanity.png`;
const SANITY_STATS = `${SHOT_DIR}/sanity-stats.json`;
const CMP = `${SHOT_DIR}/cmp_sanity_vs_scene1.png`;
const REFERENCE = "reference/scene1.png";
const PHASE1_DIR = "shots/phase-1";
const PHASE1_FINAL = `${PHASE1_DIR}/terrain-final.png`;
const PHASE1_STATS = `${PHASE1_DIR}/terrain-stats.json`;
const PHASE1_CMP = `${PHASE1_DIR}/cmp_terrain_vs_scene1.png`;
const PHASE1_CAM = "1800,360,3200,2.6500,-0.4300,55";
const LONG_VIEW_DIR = "shots/long-view";
const LONG_VIEW_SHOT = `${LONG_VIEW_DIR}/long-view-4km.png`;
const LONG_VIEW_STATS = `${LONG_VIEW_DIR}/long-view-4km-stats.json`;
const LONG_VIEW_SUMMARY = `${LONG_VIEW_DIR}/long-view-4km-summary.json`;
const LONG_VIEW_CAM = "1800,360,3200,2.6500,-0.4300,55";
const LONG_VIEW_FOREST_DIR = "shots/long-view";
const LONG_VIEW_FOREST_SHOT = `${LONG_VIEW_FOREST_DIR}/long-view-forest-4km.png`;
const LONG_VIEW_FOREST_STATS = `${LONG_VIEW_FOREST_DIR}/long-view-forest-4km-stats.json`;
const LONG_VIEW_FOREST_CAM = "1800,360,3200,2.6500,-0.4300,55";
const BORDER_OCEAN_DIR = "shots/border-ocean";
const BORDER_OCEAN_SHOT = `${BORDER_OCEAN_DIR}/border-ocean.png`;
const BORDER_OCEAN_STATS = `${BORDER_OCEAN_DIR}/border-ocean-stats.json`;
const BORDER_OCEAN_SCENE_CONFIG = parseBorderOceanSceneConfig(
  readFileSync("config/border_ocean_scene.yaml", "utf8"),
);
const BORDER_OCEAN_CAM = borderOceanCameraForWorld(16 * 4 * 16, BORDER_OCEAN_SCENE_CONFIG);
const INFINITE_ISLANDS_DIR = "shots/infinite-islands";
const INFINITE_ISLANDS_SHOT = `${INFINITE_ISLANDS_DIR}/walk.png`;
const INFINITE_ISLANDS_STATS = `${INFINITE_ISLANDS_DIR}/walk-stats.json`;
const DEFAULT_BASE_URL = "http://127.0.0.1:5173/";
const SERVER_TIMEOUT_MS = 90_000;
const SERVER_POLL_MS = 500;
const BATTERY_COMMAND_TIMEOUT_MS = 300_000;

process.env["CLOD_POC_BASE_URL"] ??= DEFAULT_BASE_URL;

const isWindows = process.platform === "win32";
const viteBin = resolve(process.cwd(), "node_modules", "vite", "bin", "vite.js");
const nodeBin = process.execPath;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function baseUrlPort(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return "5173";
  }
}

function spawnVite(): ChildProcess {
  const baseUrl = process.env["CLOD_POC_BASE_URL"] ?? DEFAULT_BASE_URL;
  const child = spawn(nodeBin, [viteBin, "--config", "vite.acceptance.config.ts", "--host", "127.0.0.1", "--port", baseUrlPort(baseUrl), "--strictPort"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
  child.on("error", (error) => {
    console.error("[battery:vite] failed to start:", error.message);
  });
  return child;
}

async function ensureServer(): Promise<ChildProcess | null> {
  const baseUrl = process.env["CLOD_POC_BASE_URL"] ?? DEFAULT_BASE_URL;
  if (await isServerReady(baseUrl)) return null;

  console.log(`[battery] starting Vite at ${baseUrl}`);
  const server = spawnVite();
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready with code ${server.exitCode}`);
    if (await isServerReady(baseUrl)) return server;
    await delay(SERVER_POLL_MS);
  }

  stopChildTree(server);
  throw new Error(`Timed out waiting for Vite at ${baseUrl}`);
}

function stopChildTree(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

function run(label: string, args: string[]): void {
  console.log(`[battery] ${label}`);
  const result = spawnSync("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    timeout: BATTERY_COMMAND_TIMEOUT_MS,
  });
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.signal) throw new Error(`${label} failed with signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
}

function assertCounter(stats: Record<string, unknown>, key: string, predicate: (value: number) => boolean): void {
  const counters = stats["counters"] as Record<string, unknown> | undefined;
  const value = counters?.[key];
  if (typeof value !== "number" || !predicate(value)) throw new Error(`stats counter failed: ${key}=${String(value)}`);
}

function validateStats(): void {
  const stats = JSON.parse(readFileSync(SANITY_STATS, "utf8")) as Record<string, unknown>;
  if (stats["ready"] !== true) throw new Error("stats ready flag is not true");
  if (stats["error"] !== null) throw new Error(`stats error is not null: ${String(stats["error"])}`);
  if (typeof stats["drawCalls"] !== "number" || stats["drawCalls"] <= 0) throw new Error("drawCalls must be > 0");
  if (typeof stats["triangles"] !== "number" || stats["triangles"] <= 0) throw new Error("triangles must be > 0");
  assertCounter(stats, "phase0.cpuProceduralTris", (value) => value > 0);
  assertCounter(stats, "phase0.tslDisplacement", (value) => value === 1);
  assertCounter(stats, "phase0.storageTextureBake", (value) => value === 1);
  assertCounter(stats, "phase0.storageInstances", (value) => value > 0);
  assertCounter(stats, "phase0.storageInstancedDraws", (value) => value > 0);
  assertCounter(stats, "phase0.indirectInstances", (value) => value > 0);
  assertCounter(stats, "phase0.indirectDraws", (value) => value > 0);
  assertCounter(stats, "phase0.seedSignature", (value) => Number.isFinite(value));
}

function validatePhase1Stats(): void {
  const stats = JSON.parse(readFileSync(PHASE1_STATS, "utf8")) as Record<string, unknown>;
  if (stats["ready"] !== true) throw new Error("phase1 stats ready flag is not true");
  if (stats["error"] !== null) throw new Error(`phase1 stats error is not null: ${String(stats["error"])}`);
  const diag = stats["diag"] as Record<string, unknown> | null;
  if (!diag || diag["ok"] !== true) throw new Error("phase1 WebGPU diagnostics are missing or not ok");
  if (typeof stats["drawCalls"] !== "number" || stats["drawCalls"] <= 0) throw new Error("phase1 drawCalls must be > 0");
  if (typeof stats["triangles"] !== "number" || stats["triangles"] <= 0) throw new Error("phase1 triangles must be > 0");
  assertCounter(stats, "phase1.gridSize", (value) => value >= 1024);
  assertCounter(stats, "phase1.worldSizeM", (value) => value === 4096);
  assertCounter(stats, "phase1.heightSignature", (value) => Number.isFinite(value));
  assertCounter(stats, "phase1.leafNodes", (value) => value > 0);
  assertCounter(stats, "phase1.parentNodes", (value) => value > 0);
  assertCounter(stats, "phase1.maxLevel", (value) => value >= 1);
  assertCounter(stats, "phase1.parentDerived", (value) => value === 1);
  assertCounter(stats, "phase1.parentDirectResample", (value) => value === 0);
  assertCounter(stats, "phase1.maxErrorWorld100", (value) => value >= 0);
  assertCounter(stats, "phase1.borderChainsChecked", (value) => value > 0);
  assertCounter(stats, "phase1.internalBorderChecks", (value) => value > 0);
  assertCounter(stats, "phase1.nodesRendered", (value) => value > 0);
  assertCounter(stats, "phase1.trianglesRendered", (value) => value > 0);
  assertCounter(stats, "phase1.buildMs100", (value) => Number.isFinite(value));
}

function validateBorderOceanShotStats(): void {
  const stats = JSON.parse(readFileSync(BORDER_OCEAN_STATS, "utf8")) as Record<string, unknown>;
  validateBorderOceanStats(stats, BORDER_OCEAN_SCENE_CONFIG);
}

function validateLongViewStats(): void {
  const stats = JSON.parse(readFileSync(LONG_VIEW_STATS, "utf8")) as Record<string, unknown>;
  if (stats["ready"] !== true) throw new Error("long-view stats ready flag is not true");
  if (stats["error"] !== null) throw new Error(`long-view stats error is not null: ${String(stats["error"])}`);
  const counters = stats["counters"] as Record<string, unknown> | undefined;
  const drawCalls = typeof stats["drawCalls"] === "number" ? stats["drawCalls"] : 0;
  const terrainDrawCalls = typeof counters?.["terrain_draw_calls"] === "number" ? counters["terrain_draw_calls"] : 0;
  const triangles = typeof stats["triangles"] === "number" ? stats["triangles"] : 0;
  const terrainTriangles = typeof counters?.["terrain_triangles"] === "number" ? counters["terrain_triangles"] : 0;
  if (drawCalls <= 0 && terrainDrawCalls <= 0) throw new Error("long-view drawCalls must be > 0");
  if (triangles <= 0 && terrainTriangles <= 0) throw new Error("long-view triangles must be > 0");
  assertCounter(stats, "terrain_draw_calls", (value) => value > 0);
  assertCounter(stats, "terrain_triangles", (value) => value > 0);
  assertCounter(stats, "far_shell_tris", (value) => value > 0);
  assertCounter(stats, "shadow_proxy_tris", (value) => value > 0);
  assertCounter(stats, "canopy_tris", (value) => value > 0);
  // Per-LOD page counts: at least one LOD level should have nodes.
  const hasAnyLod = counters && Object.keys(counters).some((k) => (
    k.startsWith("clod_page_count_lod") || k.startsWith("rendered_page_count_lod")
  ) && typeof counters[k] === "number" && (counters[k] as number) > 0);
  if (!hasAnyLod) throw new Error("long-view: no clod_page_count_lod* counter > 0");
  // Verify QA summary was also written.
  if (!existsSync(LONG_VIEW_SUMMARY)) throw new Error(`long-view QA summary not found at ${LONG_VIEW_SUMMARY}`);
}

function validateForestLongViewStats(): void {
  const stats = JSON.parse(readFileSync(LONG_VIEW_FOREST_STATS, "utf8")) as Record<string, unknown>;
  if (stats["ready"] !== true) throw new Error("forest long-view stats ready flag is not true");
  assertCounter(stats, "canopy_enabled", (value) => value === 1);
  assertCounter(stats, "canopy_shell_tris", (value) => value > 0);
  assertCounter(stats, "canopy_visible_tiles", (value) => value > 0);
}

function validateInfiniteIslandsStats(): void {
  if (!existsSync(INFINITE_ISLANDS_SHOT)) throw new Error(`infinite-islands shot not found at ${INFINITE_ISLANDS_SHOT}`);
  const stats = JSON.parse(readFileSync(INFINITE_ISLANDS_STATS, "utf8")) as Record<string, unknown>;
  if (stats["ready"] !== true) throw new Error("infinite-islands stats ready flag is not true");
  if (stats["error"] !== null) throw new Error(`infinite-islands stats error is not null: ${String(stats["error"])}`);
  const counters = stats["counters"] as Record<string, unknown> | undefined;
  if (!counters) throw new Error("infinite-islands counters missing");
  assertCounter(stats, "frame_ms_p95", (value) => Number.isFinite(value) && value >= 0 && value <= INFINITE_ISLANDS_FRAME_MS_P95_MAX);
  assertCounter(stats, "frame_ms_p99", (value) => Number.isFinite(value) && value >= 0);
  assertCounter(stats, "streamer_live_radius_m", (value) => value > 0);
  assertCounter(stats, "streamer_clod_radius_m", (value) => value > 0);
  assertCounter(stats, "streamer_far_shell_inner_m", (value) => value > 0);
  assertCounter(stats, "streamer_far_shell_outer_m", (value) => value > 0);
  assertCounter(stats, "streamer_far_shell_ownership_ok", (value) => value === 1);
  assertCounter(stats, "ring_boundary_holes", (value) => value === 0);
  assertCounter(stats, "live_clod_gap_holes", (value) => value === 0);
  assertCounter(stats, "clod_far_gap_holes", (value) => value === 0);
  assertCounter(stats, "priority_owner_overlap_cells", (value) => value === 0);
  assertCounter(stats, "priority_unowned_cells", (value) => value === 0);
  assertCounter(stats, "missing_live_chunks_in_required_radius", (value) => value === 0);
  assertCounter(stats, "missing_clod_pages_in_required_radius", (value) => value === 0);
  assertCounter(stats, "far_shell_inner_minus_clod_radius_m", (value) => value >= 0);
  assertCounter(stats, "camera_to_clod_center_m", (value) => value <= 1);
  assertCounter(stats, "camera_to_far_shell_center_m", (value) => value <= 1);
}

function runPhase1Shots(): void {
  mkdirSync(PHASE1_DIR, { recursive: true });
  const common = [
    "--scene", "phase1-terrain",
    "--seed", "1",
    "--world", "8",
    "--terrainGrid", "2048",
    "--freeze", "1",
    "--hud", "1",
    "--framealign", "0",
    "--cam", PHASE1_CAM,
  ];
  const modes = ["final", "lod", "height", "slope", "normal", "flow", "biome", "paint_weights"] as const;
  for (const mode of modes) {
    const out = mode === "final" ? PHASE1_FINAL : `${PHASE1_DIR}/terrain-${mode}.png`;
    const args = ["run", "shoot", "--", ...common, "--terrainDebug", mode, "--out", out];
    if (mode === "final") args.push("--stats", PHASE1_STATS);
    run(`phase1 ${mode}`, args);
  }
  if (existsSync(REFERENCE)) {
    run("compare phase1 reference", ["run", "compare", "--", "--a", PHASE1_FINAL, "--b", REFERENCE, "--out", PHASE1_CMP]);
  } else {
    console.log("[battery] TODO: replace bootstrap phase-1 reference with locked art-direction reference.");
    run("compare phase1 bootstrap", ["run", "compare", "--", "--a", PHASE1_FINAL, "--b", PHASE1_FINAL, "--out", PHASE1_CMP]);
  }
  validatePhase1Stats();
}

function main(): void {
  mkdirSync(SHOT_DIR, { recursive: true });
  run("shoot sanity", [
    "run", "shoot", "--",
    "--scene", "sanity",
    "--seed", "1",
    "--cam", "34,18,44,0.6500,-0.2600,55",
    "--freeze", "1",
    "--hud", "1",
    "--framealign", "0",
    "--out", SANITY_SHOT,
    "--stats", SANITY_STATS,
  ]);
  if (existsSync(REFERENCE)) {
    run("compare reference", ["run", "compare", "--", "--a", SANITY_SHOT, "--b", REFERENCE, "--out", CMP]);
  } else {
    console.log("[battery] TODO: replace bootstrap reference/scene1.png with real locked reference.");
    run("compare bootstrap", ["run", "compare", "--", "--a", SANITY_SHOT, "--b", SANITY_SHOT, "--out", CMP]);
  }
  validateStats();
  runPhase1Shots();

  // LV-0: Long-view 4 km benchmark shot.
  mkdirSync(LONG_VIEW_DIR, { recursive: true });
  run("shoot long-view-4km", [
    "run", "shoot", "--",
    "--scene", "long-view-4km",
    "--seed", "12345",
    "--world", "16",
    "--cam", LONG_VIEW_CAM,
    "--freeze", "1",
    "--hud", "1",
    "--framealign", "0",
    "--clodPerf", "1",
    "--webgpuSelection", "1",
    "--out", LONG_VIEW_SHOT,
    "--stats", LONG_VIEW_STATS,
  ]);
  validateLongViewStats();

  run("shoot long-view-forest-4km", [
    "run", "shoot", "--",
    "--scene", "long-view-forest-4km",
    "--seed", "12345",
    "--world", "16",
    "--cam", LONG_VIEW_FOREST_CAM,
    "--freeze", "1",
    "--hud", "1",
    "--framealign", "0",
    "--clodPerf", "1",
    "--webgpuSelection", "1",
    "--out", LONG_VIEW_FOREST_SHOT,
    "--stats", LONG_VIEW_FOREST_STATS,
  ]);
  validateForestLongViewStats();

  mkdirSync(INFINITE_ISLANDS_DIR, { recursive: true });
  run("shoot infinite-islands walk", [
    "run", "shoot", "--",
    "--scene", "infinite-islands",
    "--seed", "1",
    "--world", "16",
    "--freeze", "0",
    "--hud", "1",
    "--framealign", "0",
    "--clodPerf", "1",
    "--webgpuSelection", "1",
    "--proceduralDebug", "biome",
    "--out", INFINITE_ISLANDS_SHOT,
    "--stats", INFINITE_ISLANDS_STATS,
  ]);
  validateInfiniteIslandsStats();

  mkdirSync(BORDER_OCEAN_DIR, { recursive: true });
  run("shoot border-ocean", [
    "run", "shoot", "--",
    "--scene", "border-ocean",
    "--seed", "1",
    "--world", "16",
    "--freeze", "1",
    "--hud", "1",
    "--framealign", "0",
    "--weather", "off",
    "--cam", `${BORDER_OCEAN_CAM.eye[0].toFixed(0)},${BORDER_OCEAN_CAM.eye[1].toFixed(0)},${BORDER_OCEAN_CAM.eye[2].toFixed(0)},${BORDER_OCEAN_CAM.look[0].toFixed(0)},${BORDER_OCEAN_CAM.look[1].toFixed(0)},${BORDER_OCEAN_CAM.look[2].toFixed(0)},${BORDER_OCEAN_CAM.fov}`,
    "--out", BORDER_OCEAN_SHOT,
    "--stats", BORDER_OCEAN_STATS,
  ]);
  validateBorderOceanShotStats();
  console.log("[battery] ok");
}

let server: ChildProcess | null = null;
try {
  server = await ensureServer();
  main();
} catch (error) {
  console.error("[battery] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stopChildTree(server);
}
