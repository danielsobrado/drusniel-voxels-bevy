import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { clodBaseUrl, clodUrl, launchWebGPU } from "./launch.js";
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

interface ManagedServer {
  started: boolean;
  stop(): Promise<void>;
}

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEV_SERVER_POLL_MS = 500;
const DEV_SERVER_START_TIMEOUT_MS = 45_000;
const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const DEFAULT_ORBIT_SAMPLES = 8;
const DEFAULT_SETTLE_FRAMES = 24;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_TARGET: [number, number, number] = [512, 32, 512];
const DEFAULT_ORBIT_RADIUS_M = 220;
const DEFAULT_CAMERA_HEIGHT_M = 84;
const DEFAULT_FOV_DEG = 55;

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

function flag(args: Args, key: string): boolean {
  return args[key] === true || args[key] === "1" || args[key] === "true";
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

async function waitForReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => window.__drusnielClod && (window.__drusnielClod.ready || window.__drusnielClod.error !== null),
    undefined,
    { timeout: timeoutMs, polling: 250 },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(`App reported fatal error:\n${error}`);
}

async function ensureDevServer(args: Args): Promise<ManagedServer> {
  const baseUrl = clodBaseUrl();
  if (await canReach(baseUrl)) return idleServer();
  if (flag(args, "noServe")) {
    throw new Error(`CLOD-POC dev server is not reachable at ${baseUrl}; run npm --prefix tools/clod-poc run dev or omit --noServe.`);
  }
  if (process.env["CLOD_POC_BASE_URL"]) {
    throw new Error(`CLOD_POC_BASE_URL is set but is not reachable: ${baseUrl}`);
  }

  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "dev"], {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdio: "pipe",
  });
  pipeServerLogs(child);
  await waitForServer(baseUrl, child);
  console.log(`[tree-impostor-visual] dev server ready at ${baseUrl}`);
  return {
    started: true,
    async stop() {
      await stopServer(child);
    },
  };
}

function idleServer(): ManagedServer {
  return {
    started: false,
    async stop() {},
  };
}

async function canReach(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(baseUrl, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer(baseUrl: string, child: ChildProcessWithoutNullStreams): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEV_SERVER_START_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`Vite dev server exited with code ${child.exitCode}`);
    if (await canReach(baseUrl)) return;
    await delay(DEV_SERVER_POLL_MS);
  }
  throw new Error(`Timed out waiting for Vite dev server at ${baseUrl}`);
}

function pipeServerLogs(child: ChildProcessWithoutNullStreams): void {
  child.stdout.on("data", (chunk: Buffer) => process.stdout.write(`[vite] ${chunk.toString()}`));
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[vite] ${chunk.toString()}`));
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  for (let i = 0; i < 20; i++) {
    if (child.exitCode !== null) return;
    await delay(100);
  }
  child.kill("SIGKILL");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sceneArg = str(args.scene) ?? "infinite-islands";
  const scene = sceneArg === "main" || sceneArg === "default" ? null : sceneArg;
  const width = num(args, "w", DEFAULT_VIEWPORT_WIDTH);
  const height = num(args, "h", DEFAULT_VIEWPORT_HEIGHT);
  const samples = Math.max(1, Math.floor(num(args, "samples", DEFAULT_ORBIT_SAMPLES)));
  const settleFrames = Math.max(0, Math.floor(num(args, "settle", DEFAULT_SETTLE_FRAMES)));
  const timeoutMs = Math.max(1000, Math.floor(num(args, "timeout", DEFAULT_TIMEOUT_MS)));
  const target = parseVec3(str(args.target), DEFAULT_TARGET);
  const radius = Math.max(1, num(args, "radius", DEFAULT_ORBIT_RADIUS_M));
  const cameraHeight = num(args, "height", DEFAULT_CAMERA_HEIGHT_M);
  const fov = num(args, "fov", DEFAULT_FOV_DEG);
  const seed = Number(str(args.seed));
  const outDir = str(args.out) ?? "shots/trees/impostor-visual";
  const reportPath = str(args.report) ?? join(outDir, "report.json");
  const consumed = new Set([
    "scene", "seed", "target", "radius", "height", "fov", "samples", "settle", "timeout", "out", "report", "w", "h",
    "dark", "neighborDelta", "minRun", "minRunRatio", "maxWidth", "maxRuns", "maxPixelRatio", "noServe",
  ]);
  const extra: Record<string, string> = { freeze: "1" };
  for (const [key, value] of Object.entries(args)) {
    if (!consumed.has(key)) extra[key] = value === true ? "1" : String(value);
  }

  const server = await ensureDevServer(args);
  const captures: CaptureReport[] = [];
  let browser: Browser | null = null;
  const url = clodUrl({
    scene,
    seed: Number.isFinite(seed) ? seed : undefined,
    freeze: true,
    extra,
  });

  try {
    const launch = await launchWebGPU();
    browser = launch.browser;
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
    // The spike detector must only see the rendered scene: DOM overlays (GUI
    // panels, HUD windows) have thin dark borders that register as permanent
    // vertical spike false-positives at fixed screen columns.
    await page.addStyleTag({ content: "body > *:not(canvas) { visibility: hidden !important; }" });
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
    await browser?.close().catch(() => undefined);
    if (server.started) await server.stop();
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
