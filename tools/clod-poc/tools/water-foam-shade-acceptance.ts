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
} from "./water-harness.js";
import {
  buildWaterFoamAcceptanceUrl,
  getWaterFoamAcceptanceProfile,
  parseWaterFoamAcceptanceQuality,
} from "./water-foam-acceptance-profile.js";
import { evaluateWaterFoamRuntimeContract } from "./water-foam-runtime-contract.js";
import { findWaterShotPose } from "./water-shot-scenes.js";
import { evaluateWaterFoamShadeAcceptance } from "./water-foam-shade-contract.js";
import {
  deriveWaterPixelMask,
  measureFoamImage,
  measureFoamLighting,
  type RgbaImage,
} from "./water-foam-visual-metrics.js";

interface OverrideState {
  readonly enabled: boolean;
  readonly visibility: number;
}

interface CaptureFiles {
  readonly bodyMask: string;
  readonly depth: string;
  readonly foamLit: string;
  readonly foamShaded: string;
  readonly finalLit: string;
  readonly finalShaded: string;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const seed = stringArg(args, "seed", "1");
  const quality = parseWaterFoamAcceptanceQuality(stringArg(args, "quality", "high"));
  const profile = getWaterFoamAcceptanceProfile(quality);
  const sourceUrl = typeof args.url === "string" ? args.url : undefined;
  const outRoot = resolveOutputPath(stringArg(
    args,
    "out",
    join("shots/water/foam-shade-acceptance", profile.outputFolder),
  ));
  mkdirSync(outRoot, { recursive: true });

  const report = await withWaterHarness(
    { url: sourceUrl, world, width: 1280, height: 720 },
    async ({ page, url: baseUrl }) => {
      const targetUrl = buildWaterFoamAcceptanceUrl(baseUrl, seed, world, quality);
      await navigateToShadeProfile(page, targetUrl);
      const info = await waterDebugInfo(page);
      const rapidPose = await findWaterShotPose(page, "rapid-bed-step", info.worldCells);
      await setCameraPose(page, rapidPose);
      await settleFrames(page, 60);

      const files: CaptureFiles = {
        bodyMask: join(outRoot, "body-mask.png"),
        depth: join(outRoot, "depth.png"),
        foamLit: join(outRoot, "foam-lit.png"),
        foamShaded: join(outRoot, "foam-shaded.png"),
        finalLit: join(outRoot, "final-lit.png"),
        finalShaded: join(outRoot, "final-shaded.png"),
      };
      let litOverride: OverrideState | null = null;
      let shadedOverride: OverrideState | null = null;
      try {
        await setWaterDebugMode(page, "bodyMask");
        await page.screenshot(files.bodyMask);
        await setWaterDebugMode(page, "depth");
        await page.screenshot(files.depth);

        litOverride = await setFoamSunVisibilityOverride(page, 1);
        await settleFrames(page, 12);
        await setWaterDebugMode(page, "foam");
        await page.screenshot(files.foamLit);
        await setWaterDebugMode(page, "final");
        await page.screenshot(files.finalLit);

        shadedOverride = await setFoamSunVisibilityOverride(page, 0);
        await settleFrames(page, 12);
        await setWaterDebugMode(page, "foam");
        await page.screenshot(files.foamShaded);
        await setWaterDebugMode(page, "final");
        await page.screenshot(files.finalShaded);
      } finally {
        await setFoamSunVisibilityOverride(page, null).catch(() => undefined);
      }

      if (!litOverride?.enabled || litOverride.visibility !== 1) {
        throw new Error("foam shade acceptance failed to activate the fully lit override");
      }
      if (!shadedOverride?.enabled || shadedOverride.visibility !== 0) {
        throw new Error("foam shade acceptance failed to activate the fully shaded override");
      }

      const images = await loadImages(files);
      const waterMask = deriveWaterPixelMask(images.bodyMask, images.depth, images.foamLit);
      const metrics = {
        lit: measureFoamImage(images.foamLit, waterMask),
        shaded: measureFoamImage(images.foamShaded, waterMask),
        litLighting: measureFoamLighting(images.finalLit, images.foamLit, waterMask),
        shadedLighting: measureFoamLighting(images.finalShaded, images.foamShaded, waterMask),
      };
      const shadeAcceptance = evaluateWaterFoamShadeAcceptance(metrics);
      const runtimeDiagnostics = await page.evaluate<WaterFoamRuntimeDiagnostics>(
        "window.waterDebugInfo().foam",
      );
      const runtimeAcceptance = evaluateWaterFoamRuntimeContract(quality, runtimeDiagnostics);
      const acceptance = {
        passed: shadeAcceptance.passed && runtimeAcceptance.passed,
        failures: [...shadeAcceptance.failures, ...runtimeAcceptance.failures],
        shade: shadeAcceptance,
        runtime: runtimeAcceptance,
      };

      return {
        schemaVersion: 1 as const,
        targetUrl,
        seed,
        world,
        quality,
        profileQuery: profile.query,
        rapidPose,
        overrideSequence: {
          lit: litOverride,
          shaded: shadedOverride,
          reset: { enabled: false, visibility: 1 },
        },
        files,
        runtimeDiagnostics,
        metrics,
        acceptance,
      };
    },
  );

  const reportPath = join(outRoot, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`foam shade report: ${reportPath}`);
  if (!report.acceptance.passed) {
    throw new Error(`water foam shade acceptance failed for ${quality}:\n- ${report.acceptance.failures.join("\n- ")}`);
  }
  console.log(`water foam shade acceptance passed for ${quality}`);
}

async function setFoamSunVisibilityOverride(
  page: CdpPage,
  value: number | null,
): Promise<OverrideState> {
  const expression = `window.setWaterFoamSunVisibilityOverride(${value === null ? "null" : JSON.stringify(value)})`;
  const state = await page.evaluate<OverrideState>(expression);
  if (!state || typeof state.enabled !== "boolean" || !Number.isFinite(state.visibility)) {
    throw new Error("foam sun visibility override returned an invalid state");
  }
  return state;
}

async function loadImages(files: CaptureFiles): Promise<{
  readonly bodyMask: RgbaImage;
  readonly depth: RgbaImage;
  readonly foamLit: RgbaImage;
  readonly foamShaded: RgbaImage;
  readonly finalLit: RgbaImage;
  readonly finalShaded: RgbaImage;
}> {
  const [bodyMask, depth, foamLit, foamShaded, finalLit, finalShaded] = await Promise.all([
    loadImage(files.bodyMask),
    loadImage(files.depth),
    loadImage(files.foamLit),
    loadImage(files.foamShaded),
    loadImage(files.finalLit),
    loadImage(files.finalShaded),
  ]);
  return { bodyMask, depth, foamLit, foamShaded, finalLit, finalShaded };
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

async function navigateToShadeProfile(page: CdpPage, url: string): Promise<void> {
  await page.send("Page.navigate", { url });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate<boolean>(
      `location.href === ${JSON.stringify(url)}
        && typeof window.waterProbe === "function"
        && typeof window.setWaterDebugMode === "function"
        && typeof window.setCameraPose === "function"
        && typeof window.waterDebugInfo === "function"
        && typeof window.setWaterFoamSunVisibilityOverride === "function"`,
    ).catch(() => false);
    if (ready) {
      await settleFrames(page, 30);
      return;
    }
    await delay(250);
  }
  throw new Error(`timed out waiting for the infinite-islands foam shade profile: ${url}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
