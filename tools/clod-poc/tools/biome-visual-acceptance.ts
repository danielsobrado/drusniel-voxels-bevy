import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ensureBrowserExecutable } from "./browser-executable.js";
import {
  evaluateBiomeVisualAcceptance,
  type BiomeVisualRuntimeState,
} from "./biome-visual-acceptance-contract.js";
import {
  BIOME_VISUAL_SEASONS,
  buildBiomeVisualAcceptanceUrl,
  type BiomeVisualSeason,
} from "./biome-visual-acceptance-profile.js";
import {
  deriveImageDifferenceMask,
  measureImageDelta,
  unionImageMasks,
  type RgbaImage,
} from "./biome-visual-image-metrics.js";
import {
  numberArg,
  parseCliArgs,
  resolveOutputPath,
  setCameraPose,
  settleFrames,
  stringArg,
  withWaterHarness,
  type CameraPoseArgs,
  type CdpPage,
} from "./water-harness.js";

type CaptureVariant = "terrain" | "grass" | "trees" | "understory";

interface SeasonCapture {
  readonly season: BiomeVisualSeason;
  readonly targetUrl: string;
  readonly runtimeState: BiomeVisualRuntimeState;
  readonly webGpuErrors: number;
  readonly files: Readonly<Record<CaptureVariant, string>>;
}

const CAPTURE_VARIANTS: readonly CaptureVariant[] = ["terrain", "grass", "trees", "understory"];

async function main(): Promise<void> {
  ensureBrowserExecutable();
  const args = parseCliArgs(process.argv.slice(2));
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const seed = stringArg(args, "seed", "1");
  const sourceUrl = typeof args.url === "string" ? args.url : undefined;
  const output = resolveOutputPath(stringArg(args, "out", "shots/biome-visual/acceptance"));
  const pose: CameraPoseArgs = {
    x: numberArg(args, "x", 2048),
    z: numberArg(args, "z", 2048),
    y: numberArg(args, "y", 72),
    yaw: numberArg(args, "yaw", 2.65),
    pitch: numberArg(args, "pitch", -0.24),
    distance: numberArg(args, "distance", 88),
  };
  mkdirSync(output, { recursive: true });

  const report = await withWaterHarness(
    { url: sourceUrl, world, width: 1280, height: 720 },
    async ({ page, url: baseUrl }) => {
      const captures = {} as Record<BiomeVisualSeason, SeasonCapture>;
      for (const season of BIOME_VISUAL_SEASONS) {
        const targetUrl = buildBiomeVisualAcceptanceUrl(baseUrl, seed, world, season);
        captures[season] = await captureSeason(page, output, season, targetUrl, pose);
      }

      const images = await loadCaptureImages(captures);
      const grassMask = unionImageMasks(
        deriveImageDifferenceMask(images.winter.grass, images.winter.terrain),
        deriveImageDifferenceMask(images.summer.grass, images.summer.terrain),
      );
      const treesMask = unionImageMasks(
        deriveImageDifferenceMask(images.summer.trees, images.summer.terrain),
        deriveImageDifferenceMask(images.autumn.trees, images.autumn.terrain),
      );
      const understoryMask = unionImageMasks(
        deriveImageDifferenceMask(images.spring.understory, images.spring.terrain),
        deriveImageDifferenceMask(images.summer.understory, images.summer.terrain),
        deriveImageDifferenceMask(images.autumn.understory, images.autumn.terrain),
      );

      const metrics = {
        terrainWinterSummer: measureImageDelta(images.winter.terrain, images.summer.terrain),
        grassWinterSummer: measureImageDelta(images.winter.grass, images.summer.grass, grassMask),
        treesSummerAutumn: measureImageDelta(images.summer.trees, images.autumn.trees, treesMask),
        understorySummerAutumn: measureImageDelta(
          images.summer.understory,
          images.autumn.understory,
          understoryMask,
        ),
        bloomSpringAutumn: measureImageDelta(
          images.spring.understory,
          images.autumn.understory,
          understoryMask,
        ),
      };
      const runtimeStates = Object.fromEntries(
        BIOME_VISUAL_SEASONS.map((season) => [season, captures[season].runtimeState]),
      ) as Record<BiomeVisualSeason, BiomeVisualRuntimeState>;
      const webGpuErrors = Object.fromEntries(
        BIOME_VISUAL_SEASONS.map((season) => [season, captures[season].webGpuErrors]),
      ) as Record<BiomeVisualSeason, number>;
      const acceptance = evaluateBiomeVisualAcceptance({ runtimeStates, metrics, webGpuErrors });

      return {
        schemaVersion: 2 as const,
        seed,
        world,
        pose,
        captures,
        metrics,
        webGpuErrors,
        acceptance,
      };
    },
  );

  const reportPath = join(output, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`biome visual report: ${reportPath}`);
  if (!report.acceptance.passed) {
    throw new Error(`biome visual acceptance failed:\n- ${report.acceptance.failures.join("\n- ")}`);
  }
  console.log("biome visual acceptance passed");
}

async function captureSeason(
  page: CdpPage,
  output: string,
  season: BiomeVisualSeason,
  targetUrl: string,
  pose: CameraPoseArgs,
): Promise<SeasonCapture> {
  await navigateAndWait(page, targetUrl);
  await setCameraPose(page, pose);
  await settleFrames(page, 60);

  const runtimeState = await page.evaluate<BiomeVisualRuntimeState>(
    "window.__drusnielBiomeVisualState",
  );
  const seasonOutput = join(output, season);
  mkdirSync(seasonOutput, { recursive: true });
  const files = {} as Record<CaptureVariant, string>;

  for (const variant of CAPTURE_VARIANTS) {
    await setCaptureVariant(page, variant);
    await settleFrames(page, 8);
    const path = join(seasonOutput, `${variant}.png`);
    await page.screenshot(path);
    files[variant] = path;
  }
  await restoreVegetation(page);
  await settleFrames(page, 2);
  const webGpuErrors = await readWebGpuErrorCount(page);
  return { season, targetUrl, runtimeState, webGpuErrors, files };
}

async function setCaptureVariant(page: CdpPage, variant: CaptureVariant): Promise<void> {
  await page.evaluate(`window.__drusnielBiomeVisualAcceptance.setCaptureVariant(${JSON.stringify(variant)})`);
}

async function restoreVegetation(page: CdpPage): Promise<void> {
  await page.evaluate("window.__drusnielBiomeVisualAcceptance.restore()");
}

async function navigateAndWait(page: CdpPage, url: string): Promise<void> {
  await page.send("Page.navigate", { url });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate<boolean>(`(() => {
      const api = window.__drusnielBiomeVisualAcceptance;
      const hooks = window.__drusnielClod;
      if (
        typeof window.setCameraPose !== "function"
        || !api
        || window.__drusnielBiomeVisualState == null
        || hooks?.ready !== true
        || hooks.stats == null
        || !Number.isFinite(hooks.stats.counters?.webgpu_uncaptured_errors)
      ) {
        return false;
      }
      const info = api.info();
      const roots = info.roots;
      return roots.grass
        && roots.trees
        && roots.understory
        && info.farCanopyMeshes > 0
        && document.querySelector("canvas") != null;
    })()`).catch(() => false);
    if (ready) return;
    await delay(250);
  }
  throw new Error(`timed out waiting for biome visual profile: ${url}`);
}

async function readWebGpuErrorCount(page: CdpPage): Promise<number> {
  return page.evaluate<number>(`(() => {
    const value = window.__drusnielClod?.stats?.counters?.webgpu_uncaptured_errors;
    return Number.isFinite(value) ? value : -1;
  })()`);
}

async function loadCaptureImages(
  captures: Readonly<Record<BiomeVisualSeason, SeasonCapture>>,
): Promise<Record<BiomeVisualSeason, Record<CaptureVariant, RgbaImage>>> {
  const entries = await Promise.all(BIOME_VISUAL_SEASONS.map(async (season) => {
    const variants = await Promise.all(CAPTURE_VARIANTS.map(async (variant) => [
      variant,
      await loadImage(captures[season].files[variant]),
    ] as const));
    return [season, Object.fromEntries(variants) as Record<CaptureVariant, RgbaImage>] as const;
  }));
  return Object.fromEntries(entries) as Record<BiomeVisualSeason, Record<CaptureVariant, RgbaImage>>;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
