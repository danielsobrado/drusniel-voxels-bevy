import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { WaterFoamRuntimeDiagnostics } from "../src/water/water_foam_diagnostics.js";
import {
  numberArg,
  parseCliArgs,
  resolveOutputPath,
  setCameraPose,
  setWaterDebugMode,
  settleFrames,
  stringArg,
  waterDebugInfo,
  withWaterHarness,
  type CdpPage,
  type WaterDebugInfo,
} from "./water-harness.js";
import {
  buildWaterFoamAcceptanceUrl,
  getWaterFoamAcceptanceProfile,
  parseWaterFoamAcceptanceQuality,
} from "./water-foam-acceptance-profile.js";
import {
  evaluateWaterFoamBrowserErrorGate,
  installWaterFoamBrowserErrorCapture,
  readWaterFoamBrowserErrors,
} from "./water-foam-browser-error-gate.js";
import { evaluateWaterFoamDistanceAcceptance } from "./water-foam-distance-acceptance-contract.js";
import { measureWaterFoamDistanceResponse } from "./water-foam-distance-visual-metrics.js";
import {
  applyWaterFoamRendererProfile,
  parseWaterFoamAcceptanceRenderer,
  type WaterFoamAcceptanceRenderer,
} from "./water-foam-renderer-profile.js";
import { evaluateWaterFoamRuntimeContract } from "./water-foam-runtime-contract.js";
import { evaluateWaterFoamWebGlRuntimeContract } from "./water-foam-webgl-runtime-contract.js";
import { deriveWaterPixelMask, type RgbaImage } from "./water-foam-visual-metrics.js";
import { findWaterShotPose } from "./water-shot-scenes.js";

interface RendererWaterDebugInfo extends WaterDebugInfo {
  readonly rendererBackend: WaterFoamAcceptanceRenderer;
  readonly foam: WaterFoamRuntimeDiagnostics;
  readonly foamDistanceDebug: DistanceOverrideState;
  readonly foamTimeDebug: TimeFreezeState;
}

interface DistanceOverrideState {
  readonly enabled: boolean;
  readonly distanceM: number;
}

interface TimeFreezeState {
  readonly frozen: boolean;
}

interface CaptureFiles {
  readonly bodyMask: string;
  readonly depth: string;
  readonly near: string;
  readonly mid: string;
  readonly far: string;
}

interface SyntheticDistances {
  readonly nearM: number;
  readonly midM: number;
  readonly farM: number;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const seed = stringArg(args, "seed", "1");
  const quality = parseWaterFoamAcceptanceQuality(stringArg(args, "quality", "high"));
  const renderer = parseWaterFoamAcceptanceRenderer(stringArg(args, "renderer", "webgpu"));
  const profile = getWaterFoamAcceptanceProfile(quality);
  const sourceUrl = typeof args.url === "string" ? args.url : undefined;
  const outRoot = resolveOutputPath(stringArg(
    args,
    "out",
    join("shots/water/foam-distance-acceptance", renderer, quality),
  ));
  mkdirSync(outRoot, { recursive: true });

  const report = await withWaterHarness(
    { url: sourceUrl, world, width: 1280, height: 720 },
    async ({ page, url: baseUrl }) => {
      const qualityUrl = buildWaterFoamAcceptanceUrl(baseUrl, seed, world, quality);
      const targetUrl = applyWaterFoamRendererProfile(qualityUrl, renderer);
      if (renderer === "webgl") await installWaterFoamBrowserErrorCapture(page);
      await navigateToDistanceProfile(page, targetUrl);

      const info = await waterDebugInfo(page) as RendererWaterDebugInfo;
      assertRendererBackend(renderer, info.rendererBackend);
      const distances = deriveSyntheticDistances(info.foam.distanceFade);
      const rapidPose = await findWaterShotPose(page, "rapid-bed-step", info.worldCells);
      await setCameraPose(page, rapidPose);
      await settleFrames(page, 60);

      const files: CaptureFiles = {
        bodyMask: join(outRoot, "body-mask.png"),
        depth: join(outRoot, "depth.png"),
        near: join(outRoot, "foam-near.png"),
        mid: join(outRoot, "foam-mid.png"),
        far: join(outRoot, "foam-far.png"),
      };
      let frozen: TimeFreezeState | null = null;
      let nearOverride: DistanceOverrideState | null = null;
      let midOverride: DistanceOverrideState | null = null;
      let farOverride: DistanceOverrideState | null = null;
      let resetDistance: DistanceOverrideState | null = null;
      let resetTime: TimeFreezeState | null = null;

      try {
        frozen = await setWaterFoamTimeFrozen(page, true);
        await settleFrames(page, 2);
        await setWaterDebugMode(page, "bodyMask");
        await page.screenshot(files.bodyMask);
        await setWaterDebugMode(page, "depth");
        await page.screenshot(files.depth);
        await setWaterDebugMode(page, "foam");

        nearOverride = await setWaterFoamDistanceOverride(page, distances.nearM);
        await settleFrames(page, 2);
        await page.screenshot(files.near);

        midOverride = await setWaterFoamDistanceOverride(page, distances.midM);
        await settleFrames(page, 2);
        await page.screenshot(files.mid);

        farOverride = await setWaterFoamDistanceOverride(page, distances.farM);
        await settleFrames(page, 2);
        await page.screenshot(files.far);
      } finally {
        resetDistance = await setWaterFoamDistanceOverride(page, null);
        resetTime = await setWaterFoamTimeFrozen(page, false);
      }

      assertTimeState(frozen, true, "freeze");
      assertDistanceState(nearOverride, distances.nearM, "near");
      assertDistanceState(midOverride, distances.midM, "mid");
      assertDistanceState(farOverride, distances.farM, "far");
      assertDistanceState(resetDistance, null, "reset");
      assertTimeState(resetTime, false, "reset");

      const images = await loadImages(files);
      const waterMask = deriveWaterPixelMask(images.bodyMask, images.depth, images.near);
      const metrics = measureWaterFoamDistanceResponse(
        images.near,
        images.mid,
        images.far,
        waterMask,
      );
      const distanceAcceptance = evaluateWaterFoamDistanceAcceptance(metrics);
      const runtimeDiagnostics = await page.evaluate<WaterFoamRuntimeDiagnostics>(
        "window.waterDebugInfo().foam",
      );
      const runtimeAcceptance = renderer === "webgl"
        ? evaluateWaterFoamWebGlRuntimeContract(quality, runtimeDiagnostics)
        : evaluateWaterFoamRuntimeContract(quality, runtimeDiagnostics);
      const browserErrors = renderer === "webgl"
        ? await readWaterFoamBrowserErrors(page)
        : [];
      const browserAcceptance = evaluateWaterFoamBrowserErrorGate(browserErrors);
      const acceptance = {
        passed: distanceAcceptance.passed && runtimeAcceptance.passed && browserAcceptance.passed,
        failures: [
          ...distanceAcceptance.failures,
          ...runtimeAcceptance.failures,
          ...browserAcceptance.failures,
        ],
        distance: distanceAcceptance,
        runtime: runtimeAcceptance,
        browser: browserAcceptance,
      };

      return {
        schemaVersion: 1 as const,
        targetUrl,
        seed,
        world,
        renderer: {
          requested: renderer,
          actual: info.rendererBackend,
        },
        quality,
        profileQuery: profile.query,
        rapidPose,
        configuredFade: info.foam.distanceFade,
        syntheticDistances: distances,
        controlSequence: {
          frozen,
          near: nearOverride,
          mid: midOverride,
          far: farOverride,
          resetDistance,
          resetTime,
        },
        files,
        runtimeDiagnostics,
        browserErrors,
        metrics,
        acceptance,
      };
    },
  );

  const reportPath = join(outRoot, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`foam distance report: ${reportPath}`);
  if (!report.acceptance.passed) {
    throw new Error(
      `water foam distance acceptance failed for ${renderer}/${quality}:\n- ${report.acceptance.failures.join("\n- ")}`,
    );
  }
  console.log(`water foam distance acceptance passed for ${renderer}/${quality}`);
}

function deriveSyntheticDistances(
  fade: WaterFoamRuntimeDiagnostics["distanceFade"],
): SyntheticDistances {
  if (!fade.valid || !Number.isFinite(fade.startM) || !Number.isFinite(fade.endM) || fade.endM <= fade.startM) {
    throw new Error(`invalid live foam distance fade: ${JSON.stringify(fade)}`);
  }
  const width = fade.endM - fade.startM;
  return {
    nearM: Math.max(0, fade.startM - width * 0.25),
    midM: (fade.startM + fade.endM) * 0.5,
    farM: fade.endM + width * 0.25,
  };
}

async function setWaterFoamDistanceOverride(
  page: CdpPage,
  distanceM: number | null,
): Promise<DistanceOverrideState> {
  const state = await page.evaluate<DistanceOverrideState>(
    `window.setWaterFoamDistanceOverrideM(${distanceM === null ? "null" : JSON.stringify(distanceM)})`,
  );
  if (!state || typeof state.enabled !== "boolean" || !Number.isFinite(state.distanceM)) {
    throw new Error("foam distance override returned an invalid state");
  }
  return state;
}

async function setWaterFoamTimeFrozen(
  page: CdpPage,
  frozen: boolean,
): Promise<TimeFreezeState> {
  const state = await page.evaluate<TimeFreezeState>(
    `window.setWaterFoamTimeFrozen(${JSON.stringify(frozen)})`,
  );
  if (!state || typeof state.frozen !== "boolean") {
    throw new Error("foam time freeze returned an invalid state");
  }
  return state;
}

function assertDistanceState(
  state: DistanceOverrideState | null,
  expectedDistanceM: number | null,
  label: string,
): void {
  if (!state) throw new Error(`${label} foam distance state is missing`);
  if (expectedDistanceM === null) {
    if (state.enabled || state.distanceM !== 0) throw new Error("foam distance override reset failed");
    return;
  }
  if (!state.enabled || state.distanceM !== expectedDistanceM) {
    throw new Error(`${label} foam distance override did not activate at ${expectedDistanceM} m`);
  }
}

function assertTimeState(state: TimeFreezeState | null, expected: boolean, label: string): void {
  if (!state || state.frozen !== expected) {
    throw new Error(`${label} foam time state did not equal ${String(expected)}`);
  }
}

async function loadImages(files: CaptureFiles): Promise<{
  readonly bodyMask: RgbaImage;
  readonly depth: RgbaImage;
  readonly near: RgbaImage;
  readonly mid: RgbaImage;
  readonly far: RgbaImage;
}> {
  const [bodyMask, depth, near, mid, far] = await Promise.all([
    loadImage(files.bodyMask),
    loadImage(files.depth),
    loadImage(files.near),
    loadImage(files.mid),
    loadImage(files.far),
  ]);
  return { bodyMask, depth, near, mid, far };
}

async function loadImage(path: string): Promise<RgbaImage> {
  const result = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength),
    width: result.info.width,
    height: result.info.height,
    channels: result.info.channels,
  };
}

async function navigateToDistanceProfile(page: CdpPage, url: string): Promise<void> {
  await page.send("Page.navigate", { url });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate<boolean>(
      `location.href === ${JSON.stringify(url)}
        && typeof window.waterProbe === "function"
        && typeof window.setWaterDebugMode === "function"
        && typeof window.setCameraPose === "function"
        && typeof window.waterDebugInfo === "function"
        && typeof window.setWaterFoamDistanceOverrideM === "function"
        && typeof window.setWaterFoamTimeFrozen === "function"`,
    ).catch(() => false);
    if (ready) {
      await settleFrames(page, 30);
      return;
    }
    await delay(250);
  }
  throw new Error(`timed out waiting for the foam distance profile: ${url}`);
}

function assertRendererBackend(
  expected: WaterFoamAcceptanceRenderer,
  actual: WaterFoamAcceptanceRenderer,
): void {
  if (actual !== expected) {
    throw new Error(`foam distance acceptance requested ${expected} but runtime reported ${String(actual)}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
