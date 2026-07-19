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
import {
  assertWaterFoamDistanceState,
  assertWaterFoamTimeState,
  resetWaterFoamDistanceControls,
  setWaterFoamDistanceOverride,
  setWaterFoamTimeFrozen,
  type WaterFoamDistanceOverrideState,
  type WaterFoamDistanceResetState,
  type WaterFoamTimeFreezeState,
} from "./water-foam-distance-browser-controls.js";
import { evaluateWaterFoamDistanceAcceptance } from "./water-foam-distance-acceptance-contract.js";
import { deriveWaterFoamSyntheticDistances } from "./water-foam-distance-acceptance-profile.js";
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
  readonly foamDistanceDebug: WaterFoamDistanceOverrideState;
  readonly foamTimeDebug: WaterFoamTimeFreezeState;
}

interface CaptureFiles {
  readonly bodyMask: string;
  readonly depth: string;
  readonly near: string;
  readonly mid: string;
  readonly far: string;
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
      assertInitialDebugState(info);
      const distances = deriveWaterFoamSyntheticDistances(info.foam.distanceFade);
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
      let frozen: WaterFoamTimeFreezeState | null = null;
      let nearOverride: WaterFoamDistanceOverrideState | null = null;
      let midOverride: WaterFoamDistanceOverrideState | null = null;
      let farOverride: WaterFoamDistanceOverrideState | null = null;
      let reset: WaterFoamDistanceResetState | null = null;

      try {
        frozen = await setWaterFoamTimeFrozen(page, true);
        assertWaterFoamTimeState(frozen, true, "freeze");
        await settleFrames(page, 2);
        await setWaterDebugMode(page, "bodyMask");
        await page.screenshot(files.bodyMask);
        await setWaterDebugMode(page, "depth");
        await page.screenshot(files.depth);
        await setWaterDebugMode(page, "foam");

        nearOverride = await setWaterFoamDistanceOverride(page, distances.nearM);
        assertWaterFoamDistanceState(nearOverride, distances.nearM, "near");
        await settleFrames(page, 2);
        await page.screenshot(files.near);

        midOverride = await setWaterFoamDistanceOverride(page, distances.midM);
        assertWaterFoamDistanceState(midOverride, distances.midM, "mid");
        await settleFrames(page, 2);
        await page.screenshot(files.mid);

        farOverride = await setWaterFoamDistanceOverride(page, distances.farM);
        assertWaterFoamDistanceState(farOverride, distances.farM, "far");
        await settleFrames(page, 2);
        await page.screenshot(files.far);
      } finally {
        reset = await resetWaterFoamDistanceControls(page);
      }

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
          reset,
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

function assertInitialDebugState(info: RendererWaterDebugInfo): void {
  if (info.foamDistanceDebug.enabled || info.foamDistanceDebug.distanceM !== 0) {
    throw new Error("foam distance debug override was active before acceptance");
  }
  if (info.foamTimeDebug.frozen) {
    throw new Error("foam time was frozen before acceptance");
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
