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
  assertCounter(stats, "phase1.nodesRendered", (value) => value > 0);
  assertCounter(stats, "phase1.trianglesRendered", (value) => value > 0);
  assertCounter(stats, "phase1.buildMs100", (value) => Number.isFinite(value));
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
  const modes = ["final", "lod", "height", "slope", "flow"] as const;
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
  console.log("[battery] ok");
}

try {
  main();
} catch (error) {
  console.error("[battery] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
}
