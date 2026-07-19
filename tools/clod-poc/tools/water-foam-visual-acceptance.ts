import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  type CameraPoseArgs,
  type CdpPage,
  type WaterDebugInfo,
} from "./water-harness.js";
import { findWaterShotPose } from "./water-shot-scenes.js";
import {
  buildWaterFoamAcceptanceUrl,
  getWaterFoamAcceptanceProfile,
  parseWaterFoamAcceptanceQuality,
} from "./water-foam-acceptance-profile.js";
import { extractWaterFoamAcceptancePoses } from "./water-foam-pose-parity.js";
import {
  applyWaterFoamRendererProfile,
  getWaterFoamRendererProfile,
  parseWaterFoamAcceptanceRenderer,
  type WaterFoamAcceptanceRenderer,
} from "./water-foam-renderer-profile.js";
import { evaluateWaterFoamRuntimeContract } from "./water-foam-runtime-contract.js";
import { evaluateWaterFoamWebGlRuntimeContract } from "./water-foam-webgl-runtime-contract.js";
import {
  deriveWaterPixelMask,
  measureFoamImage,
  measureFoamLighting,
  measureFoamTemporal,
  type RgbaImage,
} from "./water-foam-visual-metrics.js";
import { evaluateFoamVisualAcceptance } from "./water-foam-visual-contract.js";

interface CaptureFiles {
  readonly bodyMask: string;
  readonly depth: string;
  readonly foamA: string;
  readonly foamB: string;
  readonly final: string;
}

interface SmoothRiverPose extends CameraPoseArgs {
  readonly depth: number;
  readonly flowSpeed: number;
  readonly flowDrop: number;
  readonly score: number;
}

interface SceneCapture<TPose extends CameraPoseArgs> {
  readonly pose: TPose;
  readonly files: CaptureFiles;
}

interface RendererWaterDebugInfo extends WaterDebugInfo {
  readonly rendererBackend: WaterFoamAcceptanceRenderer;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const seed = stringArg(args, "seed", "1");
  const quality = parseWaterFoamAcceptanceQuality(stringArg(args, "quality", "high"));
  const renderer = parseWaterFoamAcceptanceRenderer(stringArg(args, "renderer", "webgpu"));
  const profile = getWaterFoamAcceptanceProfile(quality);
  const rendererProfile = getWaterFoamRendererProfile(renderer);
  const sourceUrl = typeof args.url === "string" ? args.url : undefined;
  const poseReportPath = typeof args["pose-report"] === "string"
    ? resolveOutputPath(args["pose-report"])
    : null;
  const fixedPoses = poseReportPath
    ? extractWaterFoamAcceptancePoses(JSON.parse(readFileSync(poseReportPath, "utf8")))
    : null;
  const defaultFolder = rendererProfile.outputSuffix ?? profile.outputFolder;
  const defaultOut = join("shots/water/foam-acceptance", defaultFolder);
  const outRoot = resolveOutputPath(stringArg(args, "out", defaultOut));
  mkdirSync(outRoot, { recursive: true });

  const report = await withWaterHarness({ url: sourceUrl, world, width: 1280, height: 720 }, async ({ page, url: baseUrl }) => {
    const qualityUrl = buildWaterFoamAcceptanceUrl(baseUrl, seed, world, quality);
    const targetUrl = applyWaterFoamRendererProfile(qualityUrl, renderer);
    await navigateToFoamProfile(page, targetUrl);
    const info = await waterDebugInfo(page) as RendererWaterDebugInfo;
    assertRequiredDebugModes(info.debugModes);
    assertRendererBackend(renderer, info.rendererBackend);

    const rapidPose = fixedPoses?.rapid
      ?? await findWaterShotPose(page, "rapid-bed-step", info.worldCells);
    const smoothPose = fixedPoses?.smoothRiver
      ?? await findSmoothRiverPose(page, info.worldCells);
    const lakePose = fixedPoses?.lakeShore
      ?? await findWaterShotPose(page, "lake-shoreline", info.worldCells);

    const rapid = await captureScene(page, outRoot, "rapid", rapidPose, true);
    const smoothRiver = await captureScene(page, outRoot, "smooth-river", smoothPose, false);
    const lakeShore = await captureScene(page, outRoot, "lake-shore", lakePose, false);

    const rapidImages = await loadCaptureImages(rapid.files);
    const smoothImages = await loadCaptureImages(smoothRiver.files);
    const lakeImages = await loadCaptureImages(lakeShore.files);
    const rapidMask = deriveWaterPixelMask(rapidImages.bodyMask, rapidImages.depth, rapidImages.foamA);
    const smoothMask = deriveWaterPixelMask(smoothImages.bodyMask, smoothImages.depth, smoothImages.foamA);
    const lakeMask = deriveWaterPixelMask(lakeImages.bodyMask, lakeImages.depth, lakeImages.foamA);

    const metrics = {
      rapid: measureFoamImage(rapidImages.foamA, rapidMask),
      smoothRiver: measureFoamImage(smoothImages.foamA, smoothMask),
      lakeShore: measureFoamImage(lakeImages.foamA, lakeMask),
      rapidTemporal: measureFoamTemporal(rapidImages.foamA, rapidImages.foamB, rapidMask),
      rapidLighting: measureFoamLighting(rapidImages.final, rapidImages.foamB, rapidMask),
    };
    const visualAcceptance = evaluateFoamVisualAcceptance(metrics);
    const runtimeDiagnostics = await page.evaluate<WaterFoamRuntimeDiagnostics>(
      "window.waterDebugInfo().foam",
    );
    const runtimeAcceptance = renderer === "webgl"
      ? evaluateWaterFoamWebGlRuntimeContract(quality, runtimeDiagnostics)
      : evaluateWaterFoamRuntimeContract(quality, runtimeDiagnostics);
    const acceptance = {
      passed: visualAcceptance.passed && runtimeAcceptance.passed,
      failures: [...visualAcceptance.failures, ...runtimeAcceptance.failures],
      visual: visualAcceptance,
      runtime: runtimeAcceptance,
    };
    return {
      schemaVersion: 4 as const,
      targetUrl,
      seed,
      world,
      quality,
      renderer: {
        requested: renderer,
        actual: info.rendererBackend,
        query: rendererProfile.query,
      },
      profileQuery: profile.query,
      poseSource: poseReportPath
        ? { kind: "canonical-report" as const, path: poseReportPath }
        : { kind: "discovered" as const },
      runtimeDiagnostics,
      captures: { rapid, smoothRiver, lakeShore },
      metrics,
      acceptance,
    };
  });

  const reportPath = join(outRoot, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`foam visual report: ${reportPath}`);
  if (!report.acceptance.passed) {
    throw new Error(
      `water foam visual acceptance failed for ${renderer}/${quality}:\n- ${report.acceptance.failures.join("\n- ")}`,
    );
  }
  console.log(`water foam visual acceptance passed for ${renderer}/${quality}`);
}

async function captureScene<TPose extends CameraPoseArgs>(
  page: CdpPage,
  outRoot: string,
  name: string,
  pose: TPose,
  temporalProof: boolean,
): Promise<SceneCapture<TPose>> {
  const sceneOut = join(outRoot, name);
  mkdirSync(sceneOut, { recursive: true });
  await setCameraPose(page, pose);
  await settleFrames(page, 60);

  const files: CaptureFiles = {
    bodyMask: join(sceneOut, "body-mask.png"),
    depth: join(sceneOut, "depth.png"),
    foamA: join(sceneOut, "foam-a.png"),
    foamB: join(sceneOut, "foam-b.png"),
    final: join(sceneOut, "final.png"),
  };

  await setWaterDebugMode(page, "bodyMask");
  await page.screenshot(files.bodyMask);
  await setWaterDebugMode(page, "depth");
  await page.screenshot(files.depth);
  await setWaterDebugMode(page, "foam");
  await page.screenshot(files.foamA);
  await settleFrames(page, temporalProof ? 30 : 8);
  await page.screenshot(files.foamB);
  await setWaterDebugMode(page, "final");
  await page.screenshot(files.final);

  return { pose, files };
}

async function loadCaptureImages(files: CaptureFiles): Promise<{
  readonly bodyMask: RgbaImage;
  readonly depth: RgbaImage;
  readonly foamA: RgbaImage;
  readonly foamB: RgbaImage;
  readonly final: RgbaImage;
}> {
  const [bodyMask, depth, foamA, foamB, finalImage] = await Promise.all([
    loadImage(files.bodyMask),
    loadImage(files.depth),
    loadImage(files.foamA),
    loadImage(files.foamB),
    loadImage(files.final),
  ]);
  return { bodyMask, depth, foamA, foamB, final: finalImage };
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

async function findSmoothRiverPose(page: CdpPage, worldCells: number): Promise<SmoothRiverPose> {
  const pose = await page.evaluate<SmoothRiverPose | null>(`(() => {
    const probe = window.waterProbe;
    const worldCells = ${JSON.stringify(worldCells)};
    const dirs = Array.from({ length: 24 }, (_, index) => {
      const angle = index / 24 * Math.PI * 2;
      return [Math.cos(angle), Math.sin(angle)];
    });
    const nearestBank = (x, z) => {
      let best = null;
      for (const [dx, dz] of dirs) {
        for (let radius = 5; radius <= 24; radius += 2) {
          const sample = probe(x + dx * radius, z + dz * radius);
          if (sample.depth <= 0.02 || sample.bodyMask <= 0.02) {
            if (!best || radius < best.radius) best = { radius, dx, dz };
            break;
          }
        }
      }
      return best;
    };
    let best = null;
    for (let z = 128; z <= worldCells - 128; z += 8) {
      for (let x = 128; x <= worldCells - 128; x += 8) {
        const sample = probe(x, z);
        const drop = Math.abs(sample.flowDrop);
        if (sample.bodyMask < 0.3 || sample.depth < 0.10 || sample.depth > 0.85) continue;
        if (sample.flowSpeed < 0.20 || drop > 0.04) continue;
        const bank = nearestBank(x, z);
        if (!bank) continue;
        const flowLength = Math.hypot(sample.flowX, sample.flowZ);
        if (flowLength < 1e-4) continue;
        const depthScore = 1 - Math.min(1, Math.abs(sample.depth - 0.32) / 0.32);
        const score = sample.flowSpeed * 0.7 + depthScore + Math.min(bank.radius, 16) / 16 * 0.2;
        const candidate = {
          x,
          z,
          yaw: Math.atan2(sample.flowX / flowLength, -(sample.flowZ / flowLength)),
          distance: 24,
          pitch: -0.28,
          depth: sample.depth,
          flowSpeed: sample.flowSpeed,
          flowDrop: drop,
          score,
        };
        const better = !best || candidate.score > best.score + 1e-9;
        const stableTie = best && Math.abs(candidate.score - best.score) <= 1e-9
          && (candidate.z < best.z || (candidate.z === best.z && candidate.x < best.x));
        if (better || stableTie) best = candidate;
      }
    }
    return best;
  })()`);
  if (!pose) throw new Error("could not find a smooth fast river acceptance pose");
  return pose;
}

async function navigateToFoamProfile(page: CdpPage, url: string): Promise<void> {
  await page.send("Page.navigate", { url });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate<boolean>(
      `location.href === ${JSON.stringify(url)} && typeof window.waterProbe === "function" && typeof window.setWaterDebugMode === "function" && typeof window.setCameraPose === "function" && typeof window.waterDebugInfo === "function"`,
    ).catch(() => false);
    if (ready) {
      await settleFrames(page, 30);
      return;
    }
    await delay(250);
  }
  throw new Error(`timed out waiting for the infinite-islands foam acceptance profile: ${url}`);
}

function assertRequiredDebugModes(available: Readonly<Record<string, number>>): void {
  const required = ["bodyMask", "depth", "foam", "final"];
  const missing = required.filter((mode) => !(mode in available));
  if (missing.length > 0) throw new Error(`water debug API is missing modes: ${missing.join(", ")}`);
}

function assertRendererBackend(
  expected: WaterFoamAcceptanceRenderer,
  actual: WaterFoamAcceptanceRenderer,
): void {
  if (actual !== expected) {
    throw new Error(`water foam acceptance requested ${expected} but runtime reported ${String(actual)}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
