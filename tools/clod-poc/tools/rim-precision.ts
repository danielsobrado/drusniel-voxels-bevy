import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import type { Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";
import { gitSha, hostEnvironmentRecord } from "./infinite_acceptance/host_environment.js";
import { landmarkDriftSignals, type LandmarkDriftSignals, type ScreenLandmark } from "./infinite_acceptance/precision_geometry_signals.js";
import { luminanceEdgeDrift, temporalSecondDifference, type EdgeDriftSignal, type RawRgbImage, type TemporalSecondDifferenceSignal } from "./infinite_acceptance/precision_image_signals.js";
import { percentile } from "./infinite_acceptance/route_metrics.js";
import { precisionDiagnosticUrlOverrides } from "../src/precision/precision_diagnostics.js";

type Args = Record<string, string | boolean>;
type PoseName = "center" | "west-rim" | "east-rim" | "north-rim" | "south-rim"
  | "north-west-diagonal" | "north-east-diagonal" | "south-west-diagonal" | "south-east-diagonal";

interface PoseCase {
  readonly name: PoseName;
  readonly worldX: number;
  readonly worldZ: number;
  readonly cameraY: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly cameraVariant: "near-ground" | "high-altitude";
  readonly surfaceVariant: "construction" | "dense-vegetation" | "water-specular";
  readonly scene: "infinite-islands" | "rpg-village";
}

interface PixelDiff {
  changedPixels: number;
  changedPixelRatio: number;
  meanAbsoluteChannelDelta: number;
  maxChannelDelta: number;
}

interface PerfEvidence {
  sampleCount: number;
  frameMsP50: number;
  frameMsP95: number;
  frameMsP99: number;
  renderMsP95: number;
}

interface CaptureEvidence {
  floatingOrigin: boolean;
  pose: PoseName;
  worldX: number;
  worldZ: number;
  cameraVariant: PoseCase["cameraVariant"];
  surfaceVariant: PoseCase["surfaceVariant"];
  scene: PoseCase["scene"];
  url: string;
  firstImage: string;
  secondImage: string;
  diffImage: string;
  diff: PixelDiff;
  landmarkSignals: LandmarkDriftSignals;
  shadowEdgeSignal: EdgeDriftSignal;
  specularCrawlSignal: TemporalSecondDifferenceSignal;
  perf: PerfEvidence;
  counters: Record<string, number>;
}

const POSE_MATRIX: readonly PoseCase[] = Object.freeze([
  { name: "center", worldX: 0, worldZ: 0, cameraY: 96, yaw: 0, pitch: -0.35, cameraVariant: "near-ground", surfaceVariant: "construction", scene: "rpg-village" },
  { name: "west-rim", worldX: -8_000, worldZ: 0, cameraY: 96, yaw: -Math.PI / 2, pitch: -0.35, cameraVariant: "near-ground", surfaceVariant: "dense-vegetation", scene: "infinite-islands" },
  { name: "east-rim", worldX: 8_000, worldZ: 0, cameraY: 420, yaw: Math.PI / 2, pitch: -0.65, cameraVariant: "high-altitude", surfaceVariant: "water-specular", scene: "infinite-islands" },
  { name: "north-rim", worldX: 0, worldZ: -8_000, cameraY: 96, yaw: 0, pitch: -0.35, cameraVariant: "near-ground", surfaceVariant: "water-specular", scene: "infinite-islands" },
  { name: "south-rim", worldX: 0, worldZ: 8_000, cameraY: 420, yaw: Math.PI, pitch: -0.65, cameraVariant: "high-altitude", surfaceVariant: "dense-vegetation", scene: "infinite-islands" },
  { name: "north-west-diagonal", worldX: -7_500, worldZ: -7_500, cameraY: 96, yaw: -Math.PI / 4, pitch: -0.35, cameraVariant: "near-ground", surfaceVariant: "water-specular", scene: "infinite-islands" },
  { name: "north-east-diagonal", worldX: 7_500, worldZ: -7_500, cameraY: 420, yaw: Math.PI / 4, pitch: -0.65, cameraVariant: "high-altitude", surfaceVariant: "dense-vegetation", scene: "infinite-islands" },
  { name: "south-west-diagonal", worldX: -7_500, worldZ: 7_500, cameraY: 420, yaw: -3 * Math.PI / 4, pitch: -0.65, cameraVariant: "high-altitude", surfaceVariant: "water-specular", scene: "infinite-islands" },
  { name: "south-east-diagonal", worldX: 7_500, worldZ: 7_500, cameraY: 96, yaw: 3 * Math.PI / 4, pitch: -0.35, cameraVariant: "near-ground", surfaceVariant: "dense-vegetation", scene: "infinite-islands" },
]);

interface DeferredCopy {
  source: string;
  destination: string;
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index];
    if (!raw?.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index++;
    } else out[key] = true;
  }
  return out;
}

function stringArg(args: Args, key: string): string | undefined {
  return typeof args[key] === "string" ? args[key] : undefined;
}

async function imageDiff(firstPath: string, secondPath: string, diffPath: string): Promise<PixelDiff> {
  const [first, second] = await Promise.all([
    sharp(firstPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(secondPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (first.info.width !== second.info.width || first.info.height !== second.info.height || first.info.channels !== second.info.channels) {
    throw new Error("rim precision captures must have identical dimensions");
  }
  const diff = Buffer.alloc(first.data.length);
  let changedPixels = 0;
  let absoluteDelta = 0;
  let maxChannelDelta = 0;
  for (let pixel = 0; pixel < first.info.width * first.info.height; pixel++) {
    let pixelChanged = false;
    for (let channel = 0; channel < first.info.channels; channel++) {
      const index = pixel * first.info.channels + channel;
      const delta = Math.abs(first.data[index]! - second.data[index]!);
      diff[index] = delta;
      absoluteDelta += delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      pixelChanged ||= delta !== 0;
    }
    if (pixelChanged) changedPixels++;
  }
  await sharp(diff, {
    raw: { width: first.info.width, height: first.info.height, channels: first.info.channels },
  }).png().toFile(diffPath);
  const pixelCount = first.info.width * first.info.height;
  return {
    changedPixels,
    changedPixelRatio: changedPixels / pixelCount,
    meanAbsoluteChannelDelta: absoluteDelta / diff.length,
    maxChannelDelta,
  };
}

async function rawRgb(path: string): Promise<RawRgbImage> {
  const raw = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw.data, width: raw.info.width, height: raw.info.height, channels: raw.info.channels };
}

function cameraForward(pose: PoseCase): readonly [number, number, number] {
  const cosPitch = Math.cos(pose.pitch);
  return [-Math.sin(pose.yaw) * cosPitch, Math.sin(pose.pitch), -Math.cos(pose.yaw) * cosPitch];
}

function diagnosticLandmarks(pose: PoseCase): readonly { id: string; p: readonly [number, number, number]; color: string; radiusM: number }[] {
  const forward = cameraForward(pose);
  const base: readonly [number, number, number] = [
    pose.worldX + forward[0] * 120,
    pose.cameraY + forward[1] * 120,
    pose.worldZ + forward[2] * 120,
  ];
  return [
    { id: "terrain", p: base, color: "#ff00ff", radiusM: 3 },
    { id: "prop", p: [base[0] + 6, base[1] + 4, base[2] - 5], color: "#00ffff", radiusM: 2 },
  ];
}

async function waitReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => window.__drusnielClod?.ready === true || window.__drusnielClod?.error != null,
    undefined,
    { timeout: timeoutMs, polling: 250 },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(error);
}

async function sampleRimPerf(page: Page, worldX: number): Promise<PerfEvidence> {
  await page.evaluate(() => window.__drusnielClod?.beginMovementRouteProbe?.());
  const startX = await page.evaluate(() => window.__drusnielClod?.getPose?.().p[0] ?? 0);
  const direction = worldX < 0 ? -1 : 1;
  for (let frame = 1; frame <= 300; frame++) {
    const x = startX + direction * (frame / 300) * 256;
    await page.evaluate(({ nextX }) => {
      const hooks = window.__drusnielClod;
      const pose = hooks?.getPose?.();
      if (!pose || !hooks?.setPose) {
        throw new Error(`rim perf requires pose automation hooks: hooks=${Boolean(hooks)} getPose=${typeof hooks?.getPose} setPose=${typeof hooks?.setPose} ready=${String(hooks?.ready)} error=${String(hooks?.error)}`);
      }
      hooks.setPose({ ...pose, p: [nextX, pose.p[1], pose.p[2]] });
      return hooks.settle?.(1);
    }, { nextX: x });
  }
  const samples = await page.evaluate(() => {
    const recent = (window as typeof window & {
      __drusnielPerf?: { recentSamples?: Array<{ frameMs?: number; renderMs?: number }> };
    }).__drusnielPerf?.recentSamples ?? [];
    return recent.slice(-300).map((sample) => ({ frameMs: Number(sample.frameMs), renderMs: Number(sample.renderMs) }));
  });
  const frameMs = samples.map((sample) => sample.frameMs).filter(Number.isFinite);
  const renderMs = samples.map((sample) => sample.renderMs).filter(Number.isFinite);
  return {
    sampleCount: frameMs.length,
    frameMsP50: percentile(frameMs, 0.5),
    frameMsP95: percentile(frameMs, 0.95),
    frameMsP99: percentile(frameMs, 0.99),
    renderMsP95: percentile(renderMs, 0.95),
  };
}

async function captureCase(
  page: Page,
  outDir: string,
  tempDir: string,
  deferredCopies: DeferredCopy[],
  pose: PoseCase,
  floatingOrigin: boolean,
  timeoutMs: number,
): Promise<CaptureEvidence> {
  const mode = floatingOrigin ? "floating-origin" : "fp32-world";
  const stem = `${pose.name}-${mode}`;
  const firstImage = join(tempDir, `${stem}-a.png`);
  const secondImage = join(tempDir, `${stem}-b.png`);
  const diffImage = join(tempDir, `${stem}-diff.png`);
  const finalFirstImage = join(outDir, `${stem}-a.png`);
  const finalSecondImage = join(outDir, `${stem}-b.png`);
  const finalDiffImage = join(outDir, `${stem}-diff.png`);
  const dollyMiddleImage = join(tempDir, `${stem}-dolly-middle.png`);
  const dollyLastImage = join(tempDir, `${stem}-dolly-last.png`);
  const finalDollyMiddleImage = join(outDir, `${stem}-dolly-middle.png`);
  const finalDollyLastImage = join(outDir, `${stem}-dolly-last.png`);
  const url = clodUrl({
    scene: pose.scene,
    seed: 1,
    freeze: true,
    cam: `${pose.worldX},${pose.cameraY},${pose.worldZ},${pose.yaw},${pose.pitch},55`,
    extra: {
      world: "16",
      startupWorld: "4",
      clodPerf: "1",
      perfProbe: "1",
      perfWarmupFrames: "0",
      perfSampleFrames: "300",
      sunElevationDeg: "8",
      floatingOrigin: floatingOrigin ? "1" : "0",
      floatingOriginSnap: "1024",
      farSummaryLayout: "2",
      farClipmap: "1",
      farClipmapMode: "replace",
      ...precisionDiagnosticUrlOverrides(),
    },
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitReady(page, timeoutMs);
  await page.evaluate(() => window.__drusnielClod?.settle?.(600));
  const perf = await sampleRimPerf(page, pose.worldX);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitReady(page, timeoutMs);
  await page.evaluate(() => window.__drusnielClod?.settle?.(600));
  await page.evaluate((landmarks) => {
    const setLandmarks = window.__drusnielClod?.setPrecisionLandmarks;
    if (!setLandmarks) throw new Error("precision matrix requires setPrecisionLandmarks");
    setLandmarks(landmarks);
    return window.__drusnielClod?.settle?.(2);
  }, diagnosticLandmarks(pose));
  const firstLandmarks = await page.evaluate(() => window.__drusnielClod?.getPrecisionLandmarkScreenPositions?.() ?? []) as ScreenLandmark[];
  await page.screenshot({ path: firstImage });
  await page.evaluate(() => window.__drusnielClod?.settle?.(8));
  const secondLandmarks = await page.evaluate(() => window.__drusnielClod?.getPrecisionLandmarkScreenPositions?.() ?? []) as ScreenLandmark[];
  await page.screenshot({ path: secondImage });
  const diff = await imageDiff(firstImage, secondImage, diffImage);
  const forward = cameraForward(pose);
  await page.evaluate(async ({ dx, dz }) => {
    const hooks = window.__drusnielClod;
    const current = hooks?.getPose?.();
    if (!current || !hooks?.setPose || !hooks.settle) throw new Error("precision dolly requires pose hooks");
    hooks.setPose({ ...current, p: [current.p[0] + dx, current.p[1], current.p[2] + dz] });
    await hooks.settle(1);
  }, { dx: forward[0] * 0.25, dz: forward[2] * 0.25 });
  await page.screenshot({ path: dollyMiddleImage });
  await page.evaluate(async ({ dx, dz }) => {
    const hooks = window.__drusnielClod;
    const current = hooks?.getPose?.();
    if (!current || !hooks?.setPose || !hooks.settle) throw new Error("precision dolly requires pose hooks");
    hooks.setPose({ ...current, p: [current.p[0] + dx, current.p[1], current.p[2] + dz] });
    await hooks.settle(1);
  }, { dx: forward[0] * 0.25, dz: forward[2] * 0.25 });
  await page.screenshot({ path: dollyLastImage });
  const [firstRaw, secondRaw, dollyMiddleRaw, dollyLastRaw] = await Promise.all([
    rawRgb(firstImage), rawRgb(secondImage), rawRgb(dollyMiddleImage), rawRgb(dollyLastImage),
  ]);
  const landmarkSignals = landmarkDriftSignals(firstLandmarks, secondLandmarks, "terrain", "prop");
  const shadowEdgeSignal = luminanceEdgeDrift(firstRaw, secondRaw);
  const specularCrawlSignal = temporalSecondDifference(firstRaw, dollyMiddleRaw, dollyLastRaw);
  const counters = await page.evaluate(() => ({ ...(window.__drusnielClod?.stats?.counters ?? {}) })).catch((): Record<string, number> => ({}));
  deferredCopies.push(
    { source: firstImage, destination: finalFirstImage },
    { source: secondImage, destination: finalSecondImage },
    { source: diffImage, destination: finalDiffImage },
    { source: dollyMiddleImage, destination: finalDollyMiddleImage },
    { source: dollyLastImage, destination: finalDollyLastImage },
  );
  return {
    floatingOrigin,
    pose: pose.name,
    worldX: pose.worldX,
    worldZ: pose.worldZ,
    cameraVariant: pose.cameraVariant,
    surfaceVariant: pose.surfaceVariant,
    scene: pose.scene,
    url,
    firstImage: finalFirstImage.replace(/\\/g, "/"),
    secondImage: finalSecondImage.replace(/\\/g, "/"),
    diffImage: finalDiffImage.replace(/\\/g, "/"),
    diff,
    landmarkSignals,
    shadowEdgeSignal,
    specularCrawlSignal,
    perf,
    counters,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(stringArg(args, "out") ?? join("shots", "long-map-precision", new Date().toISOString().replace(/[:.]/g, "-")));
  const timeoutMs = Number(stringArg(args, "timeout-ms") ?? 360_000);
  mkdirSync(outDir, { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), "drusniel-rim-precision-"));
  const deferredCopies: DeferredCopy[] = [];
  const { browser, recipe } = await launchWebGPU();
  const evidence: CaptureEvidence[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) console.log(`[page:navigated] ${frame.url()}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") console.log(`[page:${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => console.log(`[page:error] ${error.stack ?? error.message}`));
    for (const floatingOrigin of [false, true]) {
      for (const pose of POSE_MATRIX) {
        console.log(`[rim-precision] ${pose.name} floatingOrigin=${floatingOrigin ? 1 : 0}`);
        evidence.push(await captureCase(page, outDir, tempDir, deferredCopies, pose, floatingOrigin, timeoutMs));
      }
    }
  } finally {
    await browser.close();
  }
  for (const copy of deferredCopies) copyFileSync(copy.source, copy.destination);
  rmSync(tempDir, { recursive: true, force: true });
  const report = {
    createdAt: new Date().toISOString(),
    commitSha: gitSha(),
    baseUrl: process.env["CLOD_POC_BASE_URL"] ?? "http://localhost:5173/",
    browserRecipe: recipe,
    browserVersion: browser.version(),
    environment: hostEnvironmentRecord(),
    poseMatrix: POSE_MATRIX,
    evidence,
  };
  const reportPath = join(outDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[rim-precision] report: ${reportPath}`);
}

main().catch((error: unknown) => {
  console.error("[rim-precision] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
