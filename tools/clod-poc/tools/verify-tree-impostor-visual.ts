import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { clodUrl, launchWebGPU } from "./launch.js";
import {
  detectTreeImpostorDarkSpikes,
  type TreeImpostorDarkSpikeReport,
} from "../src/trees/tree_impostor_spike_detector.js";
import type { CamPose } from "../src/core/hooks.js";

type Args = Record<string, string | boolean>;

interface CaptureReport {
  index: number;
  pose: CamPose;
  screenshotPath: string;
  spikeReport: TreeImpostorDarkSpikeReport;
}

interface VisualGateReport {
  status: "pass" | "fail";
  url: string;
  captures: CaptureReport[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(args: Args, key: string, fallback: number): number {
  const value = Number(str(args[key]));
  return Number.isFinite(value) ? value : fallback;
}

function parseVec3(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!value) return fallback;
  const parts = value.split(",").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return fallback;
  return [parts[0], parts[1], parts[2]];
}

function lookAtPose(target: [number, number, number], radius: number, height: number, angleRadians: number, fov: number): CamPose {
  const x = target[0] + Math.cos(angleRadians) * radius;
  const y = target[1] + height;
  const z = target[2] + Math.sin(angleRadians) * radius;
  const dx = target[0] - x;
  const dy = target[1] - y;
  const dz = target[2] - z;
  const horizontal = Math.max(0.0001, Math.hypot(dx, dz));
  return {
    p: [x, y, z],
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, horizontal),
    fov,
  };
}

async function waitForReady(page: Awaited<ReturnType<Awaited<ReturnType<typeof launchWebGPU>>["browser"]["newPage"]>>, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => window.__drusnielClod && (window.__drusnielClod.ready || window.__drusnielClod.error !== null),
    undefined,
    { timeout: timeoutMs, polling: 250 },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(`App reported fatal error:\n${error}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sceneArg = str(args.scene) ?? "infinite-islands";
  const scene = sceneArg === "main" || sceneArg === "default" ? null : sceneArg;
  const width = num(args, "w", 1280);
  const height = num(args, "h", 720);
  const samples = Math.max(1, Math.floor(num(args, "samples", 8)));
  const settleFrames = Math.max(0, Math.floor(num(args, "settle", 24)));
  const timeoutMs = Math.max(1000, Math.floor(num(args, "timeout", 180000)));
  const target = parseVec3(str(args.target), [512, 32, 512]);
  const radius = Math.max(1, num(args, "radius", 220));
  const cameraHeight = num(args, "height", 84);
  const fov = num(args, "fov", 55);
  const seed = Number(str(args.seed));
  const outDir = str(args.out) ?? "shots/trees/impostor-visual";
  const reportPath = str(args.report) ?? join(outDir, "report.json");
  const consumed = new Set([
    "scene", "seed", "target", "radius", "height", "fov", "samples", "settle", "timeout", "out", "report", "w", "h",
    "dark", "neighborDelta", "minRun", "minRunRatio", "maxWidth", "maxRuns", "maxPixelRatio",
  ]);
  const extra: Record<string, string> = { freeze: "1" };
  for (const [key, value] of Object.entries(args)) {
    if (!consumed.has(key)) extra[key] = value === true ? "1" : String(value);
  }
  const url = clodUrl({
    scene,
    seed: Number.isFinite(seed) ? seed : undefined,
    freeze: true,
    extra,
  });

  const { browser } = await launchWebGPU();
  const captures: CaptureReport[] = [];
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on("console", (msg: { text(): string; type(): string }) => {
      const text = msg.text();
      if (text.startsWith("[clod-poc]") || msg.type() === "error" || msg.type() === "warning") {
        console.log(`[page:${msg.type()}] ${text}`);
      }
    });
    page.on("pageerror", (error: Error) => console.error("[pageerror]", error.message));
    console.log(`[tree-impostor-visual] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForReady(page, timeoutMs);
    await page.evaluate(async (frames: number) => {
      window.__drusnielClod?.flyCamEnabled?.(false);
      await window.__drusnielClod?.settle?.(frames);
    }, settleFrames);

    mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < samples; i++) {
      const pose = lookAtPose(target, radius, cameraHeight, (i / samples) * Math.PI * 2, fov);
      await page.evaluate(async ({ nextPose, frames }) => {
        window.__drusnielClod?.setPose?.(nextPose);
        await window.__drusnielClod?.settle?.(frames);
      }, { nextPose: pose, frames: settleFrames });
      const screenshot = await page.screenshot({ type: "png" });
      const screenshotPath = join(outDir, `orbit-${String(i).padStart(2, "0")}.png`);
      await sharp(screenshot).toFile(screenshotPath);
      const raw = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const spikeReport = detectTreeImpostorDarkSpikes({
        width: raw.info.width,
        height: raw.info.height,
        rgba: raw.data,
        thresholds: {
          darkLumaThreshold: num(args, "dark", 18),
          neighborLumaDelta: num(args, "neighborDelta", 24),
          minRunPx: num(args, "minRun", 48),
          minRunRatio: num(args, "minRunRatio", 0.06),
          maxSpikeWidthPx: num(args, "maxWidth", 3),
          maxSpikeRuns: num(args, "maxRuns", 6),
          maxSpikePixelRatio: num(args, "maxPixelRatio", 0.0006),
        },
      });
      console.log(
        `[tree-impostor-visual] sample=${i} status=${spikeReport.status} ` +
          `spikes=${spikeReport.spikeRuns.length} pixelRatio=${spikeReport.spikePixelRatio.toFixed(6)}`,
      );
      captures.push({ index: i, pose, screenshotPath, spikeReport });
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const report: VisualGateReport = {
    status: captures.every((capture) => capture.spikeReport.status === "pass") ? "pass" : "fail",
    url,
    captures,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[tree-impostor-visual] wrote ${reportPath}`);
  if (report.status !== "pass") {
    throw new Error("Tree impostor visual gate failed: dark vertical spike candidates were found.");
  }
}

main().catch((error: unknown) => {
  console.error("[tree-impostor-visual] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
