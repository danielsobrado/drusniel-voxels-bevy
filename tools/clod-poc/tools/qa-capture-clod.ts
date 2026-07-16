import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { launchWebGPU } from "./launch.js";
import { loadUnifiedRegistry, selectScenes } from "../src/qa/unified/manifest.js";
import { readLinearImage } from "../src/qa/unified/image_metrics.js";
import { evaluateRegionProbe } from "../src/qa/unified/region_probes.js";
import type { UnifiedQaScene } from "../src/qa/unified/schema.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const CLOD_ROOT = resolve(REPOSITORY_ROOT, "tools/clod-poc");
const VISUAL = resolve(REPOSITORY_ROOT, "validation/manifests/visual-regression.yaml");
const PERFORMANCE = resolve(REPOSITORY_ROOT, "validation/manifests/performance-regression.yaml");
const LEGACY = resolve(REPOSITORY_ROOT, "validation/manifests/legacy-id-map.yaml");
const BASE_URL = process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5173/";

interface Args { output: string; scenes: string[]; tags: string[] }

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const registry = loadUnifiedRegistry({ visual: VISUAL, performance: PERFORMANCE, legacyMap: LEGACY });
  const selected = selectScenes(registry, args.tags, args.scenes).filter((scene) => scene.target === "clod-poc");
  if (selected.length === 0) throw new Error("no CLOD-POC scenes selected");
  const output = resolve(REPOSITORY_ROOT, args.output);
  mkdirSync(output, { recursive: true });
  const server = await ensureServer();
  const { browser } = await launchWebGPU();
  try {
    const sceneEnvironments: Record<string, unknown>[] = [];
    for (const scene of selected) sceneEnvironments.push(await captureScene(browser, scene, output));
    const deterministicScenes = selected.map((scene) => JSON.parse(readFileSync(resolve(output, "scenes", "clod-poc", scene.id, "determinism.json"), "utf8")) as unknown);
    writeFileSync(resolve(output, "determinism.json"), `${JSON.stringify({ target: "clod-poc", scenes: deterministicScenes }, null, 2)}\n`);
    const first = sceneEnvironments[0] ?? {};
    const gpu = first["gpu"] ?? null;
    const gpuText = JSON.stringify(gpu).toLowerCase();
    const authoritative = process.platform === "win32" && gpu !== null && !/(swiftshader|llvmpipe|software|warp)/u.test(gpuText);
    const git = gitState();
    writeFileSync(resolve(output, "environment.json"), `${JSON.stringify({
      schema_version: 1,
      target: "clod-poc",
      authoritative: authoritative && git.branch === "main" && !git.working_tree_dirty,
      repository_commit_sha: git.head,
      branch: git.branch,
      working_tree_dirty: git.working_tree_dirty,
      os_version: `${process.platform}-${process.arch}`,
      browser_version: first["browser_version"] ?? null,
      gpu_adapter: gpu,
      gpu_backend: "webgpu",
      viewport: first["viewport"] ?? null,
      device_pixel_ratio: first["device_pixel_ratio"] ?? null,
      scenes: selected.map((scene) => scene.id),
      captured_utc: new Date().toISOString(),
    }, null, 2)}\n`);
  } finally {
    await browser.close();
    stopServer(server);
  }
}

async function captureScene(browser: Browser, scene: UnifiedQaScene, outputRoot: string): Promise<Record<string, unknown>> {
  const page = await browser.newPage({
    viewport: { width: scene.launch.viewport[0], height: scene.launch.viewport[1] },
    deviceScaleFactor: scene.launch.device_pixel_ratio,
  });
  const sceneDir = resolve(outputRoot, "scenes", "clod-poc", scene.id);
  mkdirSync(sceneDir, { recursive: true });
  try {
    await page.goto(sceneUrl(scene), { waitUntil: "domcontentloaded", timeout: scene.settle.ready_timeout_ms });
    await page.waitForFunction(() => window.__drusnielQa?.ready() === true, undefined, { timeout: scene.settle.ready_timeout_ms });
    await page.evaluate(async ({ pose, state, warmup }) => {
      const hook = window.__drusnielQa;
      if (!hook) throw new Error("window.__drusnielQa is missing");
      const error = hook.error();
      if (error) throw new Error(error);
      await hook.setWorldState(state);
      await hook.setPose(pose);
      await hook.settle(warmup);
    }, {
      pose: {
        position: scene.launch.camera.position,
        yaw_deg: scene.launch.camera.yaw_deg,
        pitch_deg: scene.launch.camera.pitch_deg,
        fov_y_deg: scene.launch.camera.fov_y_deg,
      },
      state: {
        wind_time_s: scene.launch.weather.wind_time_s,
        cloud_time_s: scene.launch.weather.cloud_time_s,
        particle_time_s: scene.launch.weather.particle_time_s,
        water_time_s: 0,
        time_of_day_hours: scene.launch.lighting.time_of_day_hours,
        random_epoch: 0,
      },
      warmup: scene.settle.warmup_frames,
    });
    if (scene.settle.freeze_after_settle) await page.evaluate(async () => window.__drusnielQa?.freeze());
    await page.evaluate(async ({ frames, checkpoint }) => {
      await window.__drusnielQa?.settle(frames);
      await window.__drusnielQa?.runCheckpoint(checkpoint);
    }, { frames: scene.settle.settle_frames, checkpoint: scene.capture.checkpoint });

    const imagePath = resolve(sceneDir, "actual.png");
    await page.screenshot({ path: imagePath, animations: "disabled", caret: "hide" });
    const stats = await page.evaluate(async () => window.__drusnielQa?.captureStats());
    if (!stats) throw new Error(`scene ${scene.id} did not return stats`);
    writeFileSync(resolve(sceneDir, "actual.stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
    const image = await readLinearImage(imagePath);
    const probes = scene.region_probes.map((probe) => evaluateRegionProbe(image, probe));
    const metrics = { width: image.width, height: image.height, probes };
    writeFileSync(resolve(sceneDir, "actual.metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
    const stableCounters = Object.fromEntries(Object.entries(stats.engine?.counters ?? {}).filter(([key]) => /(?:signature|hash|seed|triangles|draw_calls|visible|nodes_rendered|pages_applied)$/u.test(key)).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(resolve(sceneDir, "determinism.json"), `${JSON.stringify({
      scene_id: scene.id,
      target: scene.target,
      seed: scene.launch.world_seed,
      pose: scene.launch.camera,
      world_mode: scene.launch.world_mode,
      image: { width: image.width, height: image.height, probes },
      stable_counters: stableCounters,
    }, null, 2)}\n`);
    return await page.evaluate(async () => ({ ...(window.__drusnielQa?.environment() ?? {}), browser_version: navigator.userAgent }));
  } finally {
    await page.close();
  }
}

function sceneUrl(scene: UnifiedQaScene): string {
  const url = new URL(BASE_URL);
  const params: Record<string, string> = {
    scene: scene.launch.scene,
    seed: String(scene.launch.world_seed),
    quality: scene.launch.quality,
    renderResolutionPreset: scene.launch.render_resolution_preset,
    hud: scene.capture.include_hud ? "1" : "0",
    freeze: "0",
  };
  for (const [key, value] of Object.entries(scene.launch.flags)) params[key] = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await reachable()) return null;
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "dev", "--", "--host", "127.0.0.1"], { cwd: CLOD_ROOT, env: process.env, shell: false, windowsHide: true, stdio: "inherit" });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited with ${child.exitCode}`);
    if (await reachable()) return child;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  stopServer(child);
  throw new Error(`Vite did not become ready at ${BASE_URL}`);
}

async function reachable(): Promise<boolean> { try { return (await fetch(BASE_URL)).ok; } catch { return false; } }
function stopServer(child: ChildProcess | null): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else child.kill("SIGTERM");
}
function gitState(): { head: string; branch: string; working_tree_dirty: boolean } {
  const run = (args: string[]) => execFileSync("git", args, { cwd: REPOSITORY_ROOT, encoding: "utf8", windowsHide: true }).trim();
  return {
    head: run(["rev-parse", "HEAD"]),
    branch: run(["branch", "--show-current"]),
    working_tree_dirty: run(["status", "--porcelain", "--untracked-files=normal"]) !== "",
  };
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { output: "validation-runs/capture/clod-poc", scenes: [], tags: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]; const value = argv[index + 1];
    if (arg === "--output" && value) { args.output = value; index++; }
    else if (arg === "--scene" && value) { args.scenes.push(value); index++; }
    else if (arg === "--tags" && value) { args.tags.push(...value.split(",").filter(Boolean)); index++; }
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  return args;
}

main().catch((error: unknown) => { console.error("[qa-capture-clod] error:", error instanceof Error ? error.message : error); process.exit(1); });
