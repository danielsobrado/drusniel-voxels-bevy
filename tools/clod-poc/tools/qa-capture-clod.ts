import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { launchWebGPU } from "./launch.js";
import { assertRuntimeQaBuildIdentity, currentQaBuildIdentity, type ExpectedQaBuildIdentity } from "./qa-build-identity.js";
import { waitForQaConvergence, type QaConvergenceEvidence } from "./qa-convergence.js";
import { ensureQaServer, stopQaServer } from "./qa-managed-server.js";
import { loadUnifiedRegistry, selectScenes } from "../src/qa/unified/manifest.js";
import { buildImageSignature } from "../src/qa/unified/image_signature.js";
import { loadLinearImage } from "../src/qa/unified/image_linear.js";
import { evaluateRegionProbe } from "../src/qa/unified/region_probes.js";
import type { QaWorldState } from "../src/qa/unified/browser_contract.js";
import type { UnifiedQaScene } from "../src/qa/unified/schema.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const CLOD_ROOT = resolve(REPOSITORY_ROOT, "tools/clod-poc");
const VISUAL = resolve(REPOSITORY_ROOT, "validation/manifests/visual-regression.yaml");
const PERFORMANCE = resolve(REPOSITORY_ROOT, "validation/manifests/performance-regression.yaml");
const LEGACY = resolve(REPOSITORY_ROOT, "validation/manifests/legacy-id-map.yaml");
const BASE_URL = process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5173/";
const MAX_WARMUP_FRAMES = 60;
const MAX_FINAL_SETTLE_FRAMES = 12;
const CONVERGENCE_STABLE_POLLS = 4;
const CONSOLE_ERROR_ALLOWLIST = [
  /favicon\.ico.*404/iu,
  /Failed to load resource:.*favicon/iu,
] as const;

interface Args {
  output: string;
  scenes: string[];
  tags: string[];
  replayFailures: boolean;
}

interface SceneCaptureEnvironment extends Record<string, unknown> {
  cacheKey: unknown;
  convergence: {
    initial: QaConvergenceEvidence;
    positioned: QaConvergenceEvidence;
    frozen: QaConvergenceEvidence;
  };
}

interface CaptureMessages {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const registry = loadUnifiedRegistry({ visual: VISUAL, performance: PERFORMANCE, legacyMap: LEGACY });
  const selected = selectScenes(registry, args.tags, args.scenes).filter((scene) => scene.target === "clod-poc");
  if (selected.length === 0) throw new Error("no CLOD-POC scenes selected");
  const output = resolve(REPOSITORY_ROOT, args.output);
  mkdirSync(output, { recursive: true });
  const expectedBuild = currentQaBuildIdentity(REPOSITORY_ROOT, CLOD_ROOT);
  const server = await ensureQaServer(CLOD_ROOT, BASE_URL);
  const { browser, recipe } = await launchWebGPU();
  const contexts = new Map<number, BrowserContext>();
  try {
    const sceneEnvironments: SceneCaptureEnvironment[] = [];
    for (const scene of selected) {
      const context = await contextForDpr(browser, contexts, scene.launch.device_pixel_ratio);
      sceneEnvironments.push(await captureSceneWithReplay(context, scene, output, expectedBuild, args.replayFailures));
    }
    const deterministicScenes = selected.map((scene) => JSON.parse(
      readFileSync(resolve(output, "scenes", "clod-poc", scene.id, "determinism.json"), "utf8"),
    ) as unknown);
    writeJson(resolve(output, "determinism.json"), { target: "clod-poc", scenes: deterministicScenes });
    const first = sceneEnvironments[0] ?? {};
    const gpu = first["gpu"] ?? null;
    const gpuText = JSON.stringify(gpu).toLowerCase();
    const hardwareGpu = gpu !== null && !/(swiftshader|llvmpipe|software|warp)/u.test(gpuText);
    writeJson(resolve(output, "environment.json"), {
      schema_version: 2,
      target: "clod-poc",
      authoritative: process.platform === "win32"
        && expectedBuild.branch === "main"
        && hardwareGpu
        && expectedBuild.commitSha !== "unknown"
        && !expectedBuild.workingTreeDirty,
      repository_commit_sha: expectedBuild.commitSha,
      repository_branch: expectedBuild.branch,
      working_tree_dirty: expectedBuild.workingTreeDirty,
      package_lock_sha256: expectedBuild.packageLockSha256,
      os_version: `${process.platform}-${process.arch}`,
      node_version: process.version,
      browser_version: first["browser_version"] ?? null,
      launch_recipe: recipe,
      gpu_adapter: gpu,
      gpu_backend: "webgpu",
      viewport: first["viewport"] ?? null,
      device_pixel_ratio: first["devicePixelRatio"] ?? null,
      runtime_build: first["build"] ?? null,
      world_cache_keys: sceneEnvironments.map((environment, index) => ({
        scene_id: selected[index]?.id ?? `scene-${index}`,
        key: environment.cacheKey,
      })),
      scenes: selected.map((scene) => scene.id),
      captured_utc: new Date().toISOString(),
    });
  } finally {
    await Promise.all([...contexts.values()].map((context) => context.close().catch(() => undefined)));
    await browser.close().catch(() => undefined);
    stopQaServer(server);
  }
}

async function contextForDpr(
  browser: Awaited<ReturnType<typeof launchWebGPU>>["browser"],
  contexts: Map<number, BrowserContext>,
  deviceScaleFactor: number,
): Promise<BrowserContext> {
  const existing = contexts.get(deviceScaleFactor);
  if (existing) return existing;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor,
  });
  contexts.set(deviceScaleFactor, context);
  return context;
}

async function captureSceneWithReplay(
  context: BrowserContext,
  scene: UnifiedQaScene,
  outputRoot: string,
  expectedBuild: ExpectedQaBuildIdentity,
  replayFailures: boolean,
): Promise<SceneCaptureEnvironment> {
  try {
    return await captureScene(context, scene, outputRoot, expectedBuild, 1);
  } catch (firstError) {
    writeFailure(outputRoot, scene.id, 1, firstError);
    if (!replayFailures) throw firstError;
    try {
      await captureScene(context, scene, outputRoot, expectedBuild, 2);
      writeJson(resolve(outputRoot, "scenes", "clod-poc", scene.id, "replay.json"), {
        status: "INTERMITTENT_FAILURE",
        first_error: errorMessage(firstError),
        second_attempt: "PASS",
      });
      throw new Error(`${scene.id}: intermittent QA failure; replay passed after: ${errorMessage(firstError)}`);
    } catch (secondError) {
      if (errorMessage(secondError).includes("intermittent QA failure")) throw secondError;
      writeFailure(outputRoot, scene.id, 2, secondError);
      writeJson(resolve(outputRoot, "scenes", "clod-poc", scene.id, "replay.json"), {
        status: "REPRODUCIBLE_FAILURE",
        first_error: errorMessage(firstError),
        second_error: errorMessage(secondError),
      });
      throw new Error(`${scene.id}: reproducible QA failure: ${errorMessage(secondError)}`);
    }
  }
}

async function captureScene(
  context: BrowserContext,
  scene: UnifiedQaScene,
  outputRoot: string,
  expectedBuild: ExpectedQaBuildIdentity,
  attempt: number,
): Promise<SceneCaptureEnvironment> {
  const page = await context.newPage();
  await page.setViewportSize({ width: scene.launch.viewport[0], height: scene.launch.viewport[1] });
  const messages = captureMessages(page);
  const sceneDir = resolve(outputRoot, "scenes", "clod-poc", scene.id);
  mkdirSync(sceneDir, { recursive: true });
  try {
    const url = sceneUrl(scene);
    console.log(`[qa-capture] ${scene.id} attempt=${attempt}: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: scene.settle.ready_timeout_ms });
    await page.waitForFunction(
      () => window.__drusnielQa !== undefined,
      undefined,
      { timeout: scene.settle.ready_timeout_ms, polling: 100 },
    );
    await assertRuntimeQaBuildIdentity(page, expectedBuild);
    const initial = await waitForQaConvergence(
      page,
      `${scene.id}:initial`,
      scene.settle.ready_timeout_ms,
      CONVERGENCE_STABLE_POLLS,
    );
    const state = worldStateFor(scene);
    const pose = {
      p: scene.launch.camera.position,
      yaw: degreesToRadians(scene.launch.camera.yaw_deg),
      pitch: degreesToRadians(scene.launch.camera.pitch_deg),
      fov: scene.launch.camera.fov_y_deg,
    };
    await page.evaluate(async ({ nextPose, nextState, warmupFrames }) => {
      const hook = window.__drusnielQa;
      if (!hook) throw new Error("window.__drusnielQa is missing");
      const error = hook.error();
      if (error) throw new Error(error);
      await hook.setWorldState(nextState);
      await hook.setPose(nextPose);
      await hook.settle(warmupFrames);
    }, {
      nextPose: pose,
      nextState: state,
      warmupFrames: Math.max(1, Math.min(scene.settle.warmup_frames, MAX_WARMUP_FRAMES)),
    });
    const positioned = await waitForQaConvergence(
      page,
      `${scene.id}:positioned`,
      scene.settle.ready_timeout_ms,
      CONVERGENCE_STABLE_POLLS,
    );
    await assertAppliedState(page, state, scene.id);
    if (scene.settle.freeze_after_settle) await page.evaluate(async () => window.__drusnielQa?.freeze());
    await page.evaluate(async ({ frames, checkpoint }) => {
      await window.__drusnielQa?.settle(frames);
      await window.__drusnielQa?.runCheckpoint(checkpoint);
    }, {
      frames: Math.max(1, Math.min(scene.settle.settle_frames, MAX_FINAL_SETTLE_FRAMES)),
      checkpoint: scene.capture.checkpoint,
    });
    const frozen = await waitForQaConvergence(
      page,
      `${scene.id}:frozen`,
      scene.settle.ready_timeout_ms,
      CONVERGENCE_STABLE_POLLS,
    );
    failOnRuntimeMessages(scene.id, messages);

    const imagePath = resolve(sceneDir, "actual.png");
    await page.screenshot({ path: imagePath, animations: "disabled", caret: "hide" });
    const stats = await page.evaluate(async () => window.__drusnielQa?.captureStats());
    if (!stats) throw new Error(`scene ${scene.id} did not return stats`);
    writeJson(resolve(sceneDir, "actual.stats.json"), stats);
    const image = await loadLinearImage(imagePath);
    const probes = scene.region_probes.map((probe) => evaluateRegionProbe(image, probe));
    const signature = buildImageSignature(image);
    writeJson(resolve(sceneDir, "actual.metrics.json"), {
      width: image.width,
      height: image.height,
      probes,
      signature,
    });
    writeJson(resolve(sceneDir, "actual.signature.json"), signature);
    const captured = await page.evaluate(async () => {
      const scope = window as typeof window & { __drusnielAcceptanceWorldCacheKey?: unknown };
      return {
        environment: window.__drusnielQa?.environment() ?? null,
        pose: window.__drusnielQa?.getPose() ?? null,
        worldState: window.__drusnielQa?.worldState() ?? null,
        cacheKey: scope.__drusnielAcceptanceWorldCacheKey ?? null,
      };
    });
    const stableCounters = Object.fromEntries(
      Object.entries(stats.counters)
        .filter(([key]) => /(?:signature|hash|seed|triangles|draw_calls|visible|nodes_rendered|pages_applied|readbacks)$/u.test(key))
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    writeJson(resolve(sceneDir, "determinism.json"), {
      schema_version: 2,
      scene_id: scene.id,
      target: scene.target,
      seed: scene.launch.world_seed,
      requested_pose: scene.launch.camera,
      applied_pose: captured.pose,
      requested_world_state: state,
      applied_world_state: captured.worldState,
      world_mode: scene.launch.world_mode,
      world_cache_key: captured.cacheKey,
      image: { width: image.width, height: image.height, probes, signature },
      stable_counters: stableCounters,
    });
    writeJson(resolve(sceneDir, "capture.json"), {
      schema_version: 1,
      url,
      attempt,
      world_cache_key: captured.cacheKey,
      convergence: { initial, positioned, frozen },
      messages,
    });
    return {
      ...((captured.environment ?? {}) as Record<string, unknown>),
      cacheKey: captured.cacheKey,
      browser_version: await page.evaluate(() => navigator.userAgent),
      convergence: { initial, positioned, frozen },
    };
  } catch (error) {
    await page.screenshot({
      path: resolve(sceneDir, `attempt-${attempt}-FAILED.png`),
      animations: "disabled",
      caret: "hide",
    }).catch(() => undefined);
    throw error;
  } finally {
    await page.close().catch(() => undefined);
  }
}

function worldStateFor(scene: UnifiedQaScene): QaWorldState {
  return {
    freeze: false,
    timeOfDayHours: scene.launch.lighting.time_of_day_hours,
    sunElevationDeg: scene.launch.lighting.sun_elevation_deg,
    sunAzimuthDeg: scene.launch.lighting.sun_azimuth_deg,
    windTimeS: scene.launch.weather.wind_time_s,
    cloudTimeS: scene.launch.weather.cloud_time_s,
    particleTimeS: scene.launch.weather.particle_time_s,
    precipitation: scene.launch.weather.precipitation,
  };
}

async function assertAppliedState(page: Page, expected: QaWorldState, sceneId: string): Promise<void> {
  const actual = await page.evaluate(() => window.__drusnielQa?.worldState() ?? null);
  if (!actual) throw new Error(`${sceneId}: applied QA world state is missing`);
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key as keyof QaWorldState] !== value) {
      throw new Error(`${sceneId}: QA world state ${key} was not applied`);
    }
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
    acceptance: "1",
    qa: "1",
    precisionDiag: "1",
    dynamicResolution: "0",
    taaJitter: "0",
    treeWind: "0",
    grassWind: "0",
    timeOfDayHours: String(scene.launch.lighting.time_of_day_hours),
    sunElevationDeg: String(scene.launch.lighting.sun_elevation_deg),
    sunAzimuthDeg: String(scene.launch.lighting.sun_azimuth_deg),
    weather: scene.launch.weather.precipitation === "none" ? "off" : scene.launch.weather.precipitation,
  };
  for (const [key, value] of Object.entries(scene.launch.flags)) {
    params[key] = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  }
  params["precisionDiag"] = "1";
  params["dynamicResolution"] = "0";
  params["taaJitter"] = "0";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function captureMessages(page: Page): CaptureMessages {
  const messages: CaptureMessages = { consoleErrors: [], consoleWarnings: [], pageErrors: [] };
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !CONSOLE_ERROR_ALLOWLIST.some((pattern) => pattern.test(text))) {
      messages.consoleErrors.push(text);
    } else if (message.type() === "warning") messages.consoleWarnings.push(text);
  });
  page.on("pageerror", (error) => messages.pageErrors.push(error.message));
  return messages;
}

function failOnRuntimeMessages(sceneId: string, messages: CaptureMessages): void {
  if (messages.pageErrors.length > 0) throw new Error(`${sceneId}: page error: ${messages.pageErrors[0]}`);
  if (messages.consoleErrors.length > 0) throw new Error(`${sceneId}: console error: ${messages.consoleErrors[0]}`);
}

function writeFailure(outputRoot: string, sceneId: string, attempt: number, error: unknown): void {
  const sceneDir = resolve(outputRoot, "scenes", "clod-poc", sceneId);
  mkdirSync(sceneDir, { recursive: true });
  writeJson(resolve(sceneDir, `attempt-${attempt}-failure.json`), {
    status: "FAIL",
    attempt,
    error: errorMessage(error),
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    output: "validation-runs/capture/clod-poc",
    scenes: [],
    tags: [],
    replayFailures: true,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--output" && value) { args.output = value; index++; }
    else if (arg === "--scene" && value) { args.scenes.push(value); index++; }
    else if (arg === "--tags" && value) { args.tags.push(...value.split(",").filter(Boolean)); index++; }
    else if (arg === "--no-replay") args.replayFailures = false;
    else throw new Error(`unknown or incomplete argument: ${arg}`);
  }
  return args;
}

main().catch((error: unknown) => {
  console.error("[qa-capture-clod] error:", errorMessage(error));
  process.exit(1);
});
