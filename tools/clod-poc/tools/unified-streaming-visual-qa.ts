import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import type { Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";
import { gitSha, hostEnvironmentRecord } from "./infinite_acceptance/host_environment.js";

type Pose = { p: [number, number, number]; yaw: number; pitch: number; fov: number };

const REQUIRED_ZERO = ["priority_unowned_cells", "clod_far_gap_holes", "far_clipmap_ownership_holes"] as const;

async function waitReady(page: Page, timeoutMs = 360_000): Promise<void> {
  await page.waitForFunction(
    () => window.__drusnielClod?.ready === true || window.__drusnielClod?.error != null,
    undefined,
    { timeout: timeoutMs, polling: 250 },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(error);
}

function visualUrl(debug: "final" | "ownership", legacy = false): string {
  return clodUrl({
    scene: "infinite-islands",
    seed: 1,
    hud: true,
    freeze: false,
    cam: "3000,96,2048,1.5708,-0.25,55",
    extra: {
      world: "16",
      startupWorld: "4",
      clodPerf: "1",
      perfProbe: "1",
      acceptance: "1",
      ownershipOracle: "1",
      x: "3000",
      z: "2048",
      yaw: "1.5708",
      sunElevationDeg: "8",
      farSummaryLayout: "2",
      farClipmap: legacy ? "0" : "1",
      farClipmapMode: legacy ? "overlay" : "replace",
      farClipmapDebug: debug,
    },
  });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitReady(page);
  await page.evaluate(() => window.__drusnielClod?.settle?.(600));
  await page.waitForFunction(
    () => window.__drusnielClod?.stats?.counters?.["stream_cursor_source"] === 1
      && Object.hasOwn(window.__drusnielClod?.stats?.counters ?? {}, "time_to_gameplay_ready_ms"),
    undefined,
    { timeout: 180_000, polling: 250 },
  );
}

async function waitCoverage(page: Page, label: string, timeoutMs = 360_000, requireGpuClean = true): Promise<Record<string, number>> {
  const startedAt = performance.now();
  let stable = 0;
  let counters: Record<string, number> = {};
  while (performance.now() - startedAt < timeoutMs) {
    counters = await page.evaluate(() => ({ ...(window.__drusnielClod?.stats?.counters ?? {}) }));
    const clean = REQUIRED_ZERO.every((key) => Number(counters[key]) === 0)
      && (!requireGpuClean || Number(counters["live_clod_stream_gpu_failed_batches"] ?? 0) === 0);
    stable = clean ? stable + 1 : 0;
    if (stable >= 3) return counters;
    await page.evaluate(() => window.__drusnielClod?.settle?.(30));
  }
  throw new Error(`${label} did not reach stable zero coverage: ${JSON.stringify(Object.fromEntries([
    ...REQUIRED_ZERO.map((key) => [key, counters[key]] as const),
    ["live_clod_stream_gpu_failed_batches", counters["live_clod_stream_gpu_failed_batches"]],
  ]))}`);
}

async function setPose(page: Page, pose: Pose, settleFrames: number): Promise<Record<string, number>> {
  return await page.evaluate(async ({ nextPose, frames }) => {
    const hooks = window.__drusnielClod;
    if (!hooks?.setPose || !hooks.settle) throw new Error("visual QA requires pose and settle hooks");
    hooks.setPose(nextPose);
    await hooks.settle(frames);
    return { ...(hooks.stats?.counters ?? {}) };
  }, { nextPose: pose, frames: settleFrames });
}

async function capture(page: Page, outDir: string, stem: string, pose: Pose, settleFrames: number): Promise<{ image: string; stats: string; counters: Record<string, number> }> {
  const counters = await setPose(page, pose, settleFrames);
  const image = join(outDir, `${stem}.png`);
  const stats = join(outDir, `${stem}-stats.json`);
  await page.screenshot({ path: image });
  writeFileSync(stats, `${JSON.stringify({ pose, counters }, null, 2)}\n`);
  return { image, stats, counters };
}

async function contactSheet(paths: readonly string[], out: string, columns = 4): Promise<void> {
  const width = 1280;
  const height = 720;
  const rows = Math.ceil(paths.length / columns);
  const composites = paths.map((path, index) => ({ input: path, left: (index % columns) * width, top: Math.floor(index / columns) * height }));
  await sharp({ create: { width: columns * width, height: rows * height, channels: 3, background: "black" } })
    .composite(composites)
    .png()
    .toFile(out);
}

function counterFailures(label: string, counters: Record<string, number>): string[] {
  return REQUIRED_ZERO.flatMap((key) => Number(counters[key]) === 0 ? [] : [`${label}: ${key}=${String(counters[key])}`]);
}

async function main(): Promise<void> {
  const outArg = process.argv.findIndex((arg) => arg === "--out");
  const outDir = resolve(outArg >= 0 && process.argv[outArg + 1] ? process.argv[outArg + 1]! : "shots/manual/unified-streaming-visual-qa-2026-07-18");
  mkdirSync(outDir, { recursive: true });
  const { browser, recipe } = await launchWebGPU();
  const browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (message.type() === "warning") consoleWarnings.push(message.text());
  });
  const failures: string[] = [];
  const artifacts: Array<{ image: string; stats: string; counters: Record<string, number> }> = [];
  try {
    if (process.argv.includes("--probe-coast")) {
      await load(page, visualUrl("final"));
      const pose: Pose = { p: [-7_600, 42, 0], yaw: -Math.PI / 2, pitch: -0.12, fov: 55 };
      await setPose(page, pose, 180);
      await waitCoverage(page, "grazing coast probe", 360_000, false);
      const shot = await capture(page, outDir, "grazing-coast-probe", pose, 1);
      writeFileSync(join(outDir, "coast-probe.json"), `${JSON.stringify({
        createdAt: new Date().toISOString(),
        shot,
        consoleErrors,
        consoleWarnings,
      }, null, 2)}\n`);
      console.log(`[unified-streaming-visual-qa] coast probe: ${join(outDir, "coast-probe.json")}`);
      return;
    }
    await load(page, visualUrl("ownership"));
    await waitCoverage(page, "ownership traversal start");
    const ownershipFrames = [];
    for (let index = 0; index < 8; index++) {
      const x = 3_000 + index * 16;
      const shot = await capture(page, outDir, `ownership-traverse-${String(index).padStart(2, "0")}`, { p: [x, 96, 2048], yaw: Math.PI / 2, pitch: -0.25, fov: 55 }, index === 0 ? 30 : 1);
      artifacts.push(shot);
      ownershipFrames.push(shot.image);
      failures.push(...counterFailures(`ownership frame ${index}`, shot.counters));
    }
    await contactSheet(ownershipFrames, join(outDir, "ownership-traversal-contact-sheet.png"));
    if (process.argv.includes("--probe-active")) {
      const probe = {
        createdAt: new Date().toISOString(),
        artifacts,
        failures,
        passed: failures.length === 0,
      };
      writeFileSync(join(outDir, "active-probe.json"), `${JSON.stringify(probe, null, 2)}\n`);
      console.log(`[unified-streaming-visual-qa] active probe: ${join(outDir, "active-probe.json")}`);
      return;
    }

    await load(page, visualUrl("final"));
    await setPose(page, { p: [-7_600, 42, 0], yaw: -Math.PI / 2, pitch: -0.12, fov: 55 }, 180);
    await waitCoverage(page, "grazing coast start");
    const grazingFrames = [];
    for (let index = 0; index < 6; index++) {
      const x = -7_600 - index * 8;
      const shot = await capture(page, outDir, `final-grazing-coast-${String(index).padStart(2, "0")}`, { p: [x, 42, 0], yaw: -Math.PI / 2, pitch: -0.12, fov: 55 }, index === 0 ? 1 : 1);
      artifacts.push(shot);
      grazingFrames.push(shot.image);
      failures.push(...counterFailures(`grazing frame ${index}`, shot.counters));
    }
    await contactSheet(grazingFrames, join(outDir, "final-grazing-coast-contact-sheet.png"), 3);

    await load(page, visualUrl("final"));
    await waitCoverage(page, "streaming switch start");
    await setPose(page, { p: [3_200, 96, 2048], yaw: Math.PI / 2, pitch: -0.25, fov: 55 }, 180);
    await waitCoverage(page, "streaming switch on-before");
    const switchOnBefore = await capture(page, outDir, "streaming-switch-on-before", { p: [3_200, 96, 2048], yaw: Math.PI / 2, pitch: -0.25, fov: 55 }, 1);
    await page.evaluate(() => window.__drusnielClod?.setTerrainStreamingEnabled?.(false));
    const switchOff = await capture(page, outDir, "streaming-switch-off-moving", { p: [3_264, 96, 2048], yaw: Math.PI / 2, pitch: -0.25, fov: 55 }, 30);
    if (switchOff.counters["terrain_streaming_enabled"] !== 0 || (switchOff.counters["terrain_streaming_frozen_frames"] ?? 0) < 30) {
      failures.push("terrain-streaming switch did not remain frozen for the off capture");
    }
    await page.evaluate(() => window.__drusnielClod?.setTerrainStreamingEnabled?.(true));
    await setPose(page, { p: [3_264, 96, 2048], yaw: Math.PI / 2, pitch: -0.25, fov: 55 }, 180);
    await waitCoverage(page, "streaming switch resumed");
    const switchOnAfter = await capture(page, outDir, "streaming-switch-on-after", { p: [3_264, 96, 2048], yaw: Math.PI / 2, pitch: -0.25, fov: 55 }, 1);
    artifacts.push(switchOnBefore, switchOff, switchOnAfter);
    failures.push(...counterFailures("streaming switch resumed", switchOnAfter.counters));
    await contactSheet([switchOnBefore.image, switchOff.image, switchOnAfter.image], join(outDir, "streaming-switch-contact-sheet.png"), 3);

    await load(page, visualUrl("final", true));
    const legacy = await capture(page, outDir, "legacy-annular-shell", { p: [3_200, 96, 2048], yaw: Math.PI / 2, pitch: -0.25, fov: 55 }, 180);
    artifacts.push(legacy);
  } finally {
    await browser.close();
  }
  const report = {
    createdAt: new Date().toISOString(),
    commitSha: gitSha(),
    environment: { ...hostEnvironmentRecord(), browserVersion, viewport: { width: 1280, height: 720, deviceScaleFactor: 1 } },
    browserRecipe: recipe,
    urls: { ownership: visualUrl("ownership"), final: visualUrl("final"), legacy: visualUrl("final", true) },
    artifacts,
    consoleErrors,
    consoleWarnings,
    failures,
    passed: failures.length === 0,
  };
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[unified-streaming-visual-qa] report: ${join(outDir, "report.json")}`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[unified-streaming-visual-qa] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
