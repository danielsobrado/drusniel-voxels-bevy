import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import type { Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";
import { percentile } from "./infinite_acceptance/route_metrics.js";
import { precisionDiagnosticUrlOverrides } from "../src/precision/precision_diagnostics.js";

type Args = Record<string, string | boolean>;
type PoseName = "center" | "west-rim" | "east-rim";

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
  firstImage: string;
  secondImage: string;
  diffImage: string;
  diff: PixelDiff;
  perf: PerfEvidence;
  counters: Record<string, number>;
}

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

async function waitReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => window.__drusnielClod?.ready === true || window.__drusnielClod?.error !== null,
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
  pose: PoseName,
  worldX: number,
  floatingOrigin: boolean,
  timeoutMs: number,
): Promise<CaptureEvidence> {
  const mode = floatingOrigin ? "floating-origin" : "fp32-world";
  const stem = `${pose}-${mode}`;
  const firstImage = join(tempDir, `${stem}-a.png`);
  const secondImage = join(tempDir, `${stem}-b.png`);
  const diffImage = join(tempDir, `${stem}-diff.png`);
  const finalFirstImage = join(outDir, `${stem}-a.png`);
  const finalSecondImage = join(outDir, `${stem}-b.png`);
  const finalDiffImage = join(outDir, `${stem}-diff.png`);
  const url = clodUrl({
    scene: "infinite-islands",
    seed: 1,
    freeze: true,
    extra: {
      x: String(worldX),
      z: "0",
      yaw: "1.5708",
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
  const perf = await sampleRimPerf(page, worldX);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitReady(page, timeoutMs);
  await page.evaluate(() => window.__drusnielClod?.settle?.(600));
  await page.screenshot({ path: firstImage });
  await page.evaluate(() => window.__drusnielClod?.settle?.(8));
  await page.screenshot({ path: secondImage });
  const diff = await imageDiff(firstImage, secondImage, diffImage);
  const counters = await page.evaluate(() => ({ ...(window.__drusnielClod?.stats?.counters ?? {}) })).catch((): Record<string, number> => ({}));
  deferredCopies.push(
    { source: firstImage, destination: finalFirstImage },
    { source: secondImage, destination: finalSecondImage },
    { source: diffImage, destination: finalDiffImage },
  );
  return {
    floatingOrigin,
    pose,
    worldX,
    firstImage: finalFirstImage.replace(/\\/g, "/"),
    secondImage: finalSecondImage.replace(/\\/g, "/"),
    diffImage: finalDiffImage.replace(/\\/g, "/"),
    diff,
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) console.log(`[page:navigated] ${frame.url()}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") console.log(`[page:${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => console.log(`[page:error] ${error.message}`));
    for (const floatingOrigin of [false, true]) {
      for (const [pose, worldX] of [["center", 0], ["west-rim", -8_000], ["east-rim", 8_000]] as const) {
        console.log(`[rim-precision] ${pose} floatingOrigin=${floatingOrigin ? 1 : 0}`);
        evidence.push(await captureCase(page, outDir, tempDir, deferredCopies, pose, worldX, floatingOrigin, timeoutMs));
      }
    }
  } finally {
    await browser.close();
  }
  for (const copy of deferredCopies) copyFileSync(copy.source, copy.destination);
  rmSync(tempDir, { recursive: true, force: true });
  const report = {
    createdAt: new Date().toISOString(),
    baseUrl: process.env["CLOD_POC_BASE_URL"] ?? "http://localhost:5173/",
    browserRecipe: recipe,
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
