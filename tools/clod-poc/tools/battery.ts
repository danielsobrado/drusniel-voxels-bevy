import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

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

function run(label: string, args: string[]): void {
  console.log(`[battery] ${label}`);
  const result = spawnSync("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
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

function validateLongViewStats(): void {
  const stats = JSON.parse(readFileSync(LONG_VIEW_STATS, "utf8")) as Record<string, unknown>;
  if (stats["ready"] !== true) throw new Error("long-view stats ready flag is not true");
  if (stats["error"] !== null) throw new Error(`long-view stats error is not null: ${String(stats["error"])}`);
  if (typeof stats["drawCalls"] !== "number" || stats["drawCalls"] <= 0) throw new Error("long-view drawCalls must be > 0");
  if (typeof stats["triangles"] !== "number" || stats["triangles"] <= 0) throw new Error("long-view triangles must be > 0");
  assertCounter(stats, "terrain_draw_calls", (value) => value > 0);
  assertCounter(stats, "terrain_triangles", (value) => value > 0);
  // LV-0 baseline: placeholder counters should be 0 (layers not built yet).
  assertCounter(stats, "far_shell_tris", (value) => value === 0);
  assertCounter(stats, "shadow_proxy_tris", (value) => value === 0);
  assertCounter(stats, "canopy_tris", (value) => value === 0);
  // Per-LOD page counts: at least one LOD level should have nodes.
  const counters = stats["counters"] as Record<string, unknown> | undefined;
  const hasAnyLod = counters && Object.keys(counters).some((k) => k.startsWith("clod_page_count_lod") && typeof counters[k] === "number" && (counters[k] as number) > 0);
  if (!hasAnyLod) throw new Error("long-view: no clod_page_count_lod* counter > 0");
  // Verify QA summary was also written.
  if (!existsSync(LONG_VIEW_SUMMARY)) throw new Error(`long-view QA summary not found at ${LONG_VIEW_SUMMARY}`);
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
  console.log("[battery] ok");
}

try {
  main();
} catch (error) {
  console.error("[battery] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
}
