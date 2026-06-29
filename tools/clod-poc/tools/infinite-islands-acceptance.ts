import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import sharp from "sharp";
import type { Browser, Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";
import { inspectPngSanity, type ImageSanityResult } from "./infinite_acceptance/image_sanity.js";
import { aggregatePassed, renderMarkdownReport, type SceneReportInput } from "./infinite_acceptance/report.js";
import {
  evaluateThresholds,
  extractAcceptanceCounters,
  REQUIRED_COUNTERS,
  THRESHOLD_RULES,
  type ThresholdEvaluation,
} from "./infinite_acceptance/thresholds.js";

process.env["CLOD_POC_BASE_URL"] ??= "http://127.0.0.1:5180/";

const WIDTH = 1920;
const HEIGHT = 1080;
const READY_TIMEOUT_MS = 120_000;
const SETTLE_TIMEOUT_MS = 30_000;
const CONSOLE_PRINT_LIMIT = 24;
const PAGE_ERROR_PRINT_LIMIT = 8;
const PAGE_ERROR_STORE_LIMIT = 50;
const WARMUP_FRAMES = 30;
const SAMPLE_FRAMES = 180;
const RUN_ROOT = resolve("acceptance-runs/infinite-islands");

type JsonRecord = Record<string, unknown>;

interface SceneSpec {
  name: string;
  screenshot: string;
  freeze: boolean;
  proceduralDebug?: string;
  cam?: string;
  summary?: boolean;
}

interface SceneResult extends SceneReportInput {
  url: string;
  statsPath: string;
  phase0Path: string;
  summaryPath: string | null;
  comparisonPath: string;
  imageSanity: ImageSanityResult;
  consoleWarnings: string[];
  consoleErrors: string[];
  pageErrors: string[];
}

const SCENES: SceneSpec[] = [
  {
    name: "walk",
    screenshot: "walk.png",
    freeze: false,
    proceduralDebug: "biome",
    summary: true,
  },
  {
    name: "biome-near",
    screenshot: "biome-near.png",
    freeze: true,
    proceduralDebug: "biome",
    cam: "2048,96,2048,2.6500,-0.4300,55",
  },
  {
    name: "biome-horizon",
    screenshot: "biome-horizon.png",
    freeze: true,
    proceduralDebug: "biome",
    cam: "2048,260,4096,2.6500,-0.3000,55",
  },
  {
    name: "final-near",
    screenshot: "final-near.png",
    freeze: true,
    cam: "2048,96,2048,2.6500,-0.4300,55",
  },
  {
    name: "final-horizon",
    screenshot: "final-horizon.png",
    freeze: true,
    cam: "2048,260,4096,2.6500,-0.3000,55",
  },
];

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}

function timestampForFolder(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeBootstrapDiff(aPath: string, outPath: string): Promise<void> {
  const metadata = await sharp(aPath).metadata();
  const width = Math.max(1, metadata.width ?? WIDTH);
  const height = Math.max(1, metadata.height ?? HEIGHT);
  const diff = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(aPath)
    .composite([{ input: diff, left: 0, top: 0 }])
    .png()
    .toFile(outPath);
}

function qaSummary(scene: string, stats: JsonRecord): JsonRecord {
  const counters = (stats["counters"] as Record<string, number> | undefined) ?? {};
  return {
    schema_version: 1,
    scene,
    platform: "web",
    checkpoints: [{
      name: "main",
      median_frame_ms: counters["frame_ms_avg"] ?? stats["frameMs"] ?? 0,
      p95_frame_ms: counters["frame_ms_p95"] ?? stats["frameMsP95"] ?? 0,
      p99_frame_ms: counters["frame_ms_p99"] ?? 0,
      areas: {
        renderer: {
          draw_calls: counters["draw_calls"] ?? stats["drawCalls"] ?? 0,
          triangles: counters["total_scene_tris"] ?? stats["triangles"] ?? 0,
        },
        clod: {
          terrain_draw_calls: counters["terrain_draw_calls"] ?? 0,
          terrain_triangles: counters["rendered_terrain_tris"] ?? 0,
          ring_boundary_holes: counters["ring_boundary_holes"] ?? 0,
          live_clod_gap_holes: counters["live_clod_gap_holes"] ?? 0,
          clod_far_gap_holes: counters["clod_far_gap_holes"] ?? 0,
          missing_live_chunks_in_required_radius: counters["missing_live_chunks_in_required_radius"] ?? 0,
          missing_clod_pages_in_required_radius: counters["missing_clod_pages_in_required_radius"] ?? 0,
        },
        far_shell: {
          enabled: counters["far_shell_enabled"] ?? 0,
          triangles: counters["far_shell_tris"] ?? 0,
          radius_m: counters["far_shell_radius_m"] ?? 0,
          grid_res: counters["far_shell_grid_res"] ?? 0,
          ownership_ok: counters["streamer_far_shell_ownership_ok"] ?? 0,
        },
        far_summary: {
          required: counters["far_summary_tiles_required"] ?? 0,
          ready: counters["far_summary_tiles_ready"] ?? 0,
          missing: counters["far_summary_tiles_missing"] ?? 0,
          stale: counters["far_summary_tiles_stale"] ?? 0,
        },
      },
    }],
  };
}

async function waitReady(page: Page, sceneName: string, failedPath: string): Promise<void> {
  await page.waitForFunction(
    () => {
      const hooks = (window as typeof window & {
        __drusnielClod?: { ready?: boolean; error?: string | null };
      }).__drusnielClod;
      return Boolean(hooks && (hooks.ready || hooks.error !== null));
    },
    undefined,
    { timeout: READY_TIMEOUT_MS, polling: 250 },
  ).catch(async () => {
    const progress = await page.evaluate(() => {
      const hooks = (window as typeof window & {
        __drusnielClod?: { progress?: number; progressMsg?: string };
      }).__drusnielClod;
      return hooks ? `${hooks.progressMsg ?? "unknown"} (${hooks.progress ?? 0})` : "no hooks";
    });
    throw new Error(`${sceneName}: timed out waiting for ready; last progress: ${progress}`);
  });

  const appError = await page.evaluate(() => {
    const hooks = (window as typeof window & { __drusnielClod?: { error?: string | null } }).__drusnielClod;
    return hooks?.error ?? null;
  });
  if (appError) {
    await page.screenshot({ path: failedPath }).catch(() => undefined);
    throw new Error(`${sceneName}: app reported fatal error: ${appError}`);
  }
}

async function failOnPageError(page: Page, sceneName: string, pageErrors: string[], failedPath: string): Promise<void> {
  const first = pageErrors[0];
  if (!first) return;
  await page.screenshot({ path: failedPath }).catch(() => undefined);
  throw new Error(`${sceneName}: page error: ${first}`);
}

async function readStats(page: Page): Promise<JsonRecord> {
  return await page.evaluate(() => {
    const hooks = (window as typeof window & {
      __drusnielClod?: {
        ready?: boolean;
        error?: string | null;
        diag?: unknown;
        stats?: Record<string, unknown> | null;
      };
    }).__drusnielClod;
    return JSON.parse(JSON.stringify({
      ready: hooks?.ready ?? false,
      error: hooks ? hooks.error ?? null : "missing hooks",
      diag: hooks?.diag ?? null,
      ...(hooks?.stats ?? {}),
    })) as Record<string, unknown>;
  });
}

async function readPhase0Report(page: Page): Promise<JsonRecord> {
  return await page.evaluate(() => {
    const report = (window as typeof window & { __drusnielPhase0Report?: unknown }).__drusnielPhase0Report;
    return report
      ? { available: true, report: JSON.parse(JSON.stringify(report)) }
      : { available: false };
  });
}

async function settle(page: Page, frames: number): Promise<void> {
  await Promise.race([
    page.evaluate(async (settleFrames) => {
      const hooks = (window as typeof window & {
        __drusnielClod?: { settle?: ((frames?: number) => Promise<void>) | null };
      }).__drusnielClod;
      await hooks?.settle?.(settleFrames);
    }, frames),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`settle(${frames}) timed out after ${SETTLE_TIMEOUT_MS}ms`)), SETTLE_TIMEOUT_MS);
    }),
  ]);

  const appError = await page.evaluate(() => {
    const hooks = (window as typeof window & {
      __drusnielClod?: { error?: string | null };
    }).__drusnielClod;
    return hooks?.error ?? null;
  });
  if (appError) throw new Error(`app reported fatal error after settle(${frames}): ${appError}`);
}

async function runScene(browser: Browser, scene: SceneSpec, outDir: string): Promise<SceneResult> {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const consoleWarnings: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let rejectPageError: ((error: Error) => void) | null = null;
  const pageErrorGate = new Promise<never>((_, reject) => {
    rejectPageError = reject;
  });
  pageErrorGate.catch(() => undefined);
  const loggedConsoleMessages = new Set<string>();
  let printedConsoleMessages = 0;
  let printedPageErrors = 0;
  let suppressedPageErrorNotice = false;
  const screenshotPath = resolve(outDir, scene.screenshot);
  const failedPath = screenshotPath.replace(/\.png$/i, "-FAILED.png");
  const statsPath = resolve(outDir, `${scene.name}-stats.json`);
  const phase0Path = resolve(outDir, `${scene.name}-phase0-report.json`);
  const summaryPath = scene.summary ? resolve(outDir, `${scene.name}-summary.json`) : null;
  const comparisonPath = resolve(outDir, `compare/${scene.name}-self-diff.png`);

  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "warning") {
      consoleWarnings.push(text);
      const key = `${type}:${text}`;
      if (!loggedConsoleMessages.has(key) && printedConsoleMessages < CONSOLE_PRINT_LIMIT) {
        loggedConsoleMessages.add(key);
        printedConsoleMessages++;
        console.log(`[page:warning] ${text}`);
      }
    } else if (type === "error") {
      consoleErrors.push(text);
      const key = `${type}:${text}`;
      if (!loggedConsoleMessages.has(key) && printedConsoleMessages < CONSOLE_PRINT_LIMIT) {
        loggedConsoleMessages.add(key);
        printedConsoleMessages++;
        console.log(`[page:error] ${text}`);
      }
    }
  });
  page.on("pageerror", (error) => {
    if (pageErrors.length < PAGE_ERROR_STORE_LIMIT) pageErrors.push(error.message);
    rejectPageError?.(new Error(`${scene.name}: page error: ${error.message}`));
    if (printedPageErrors < PAGE_ERROR_PRINT_LIMIT) {
      printedPageErrors++;
      console.log(`[page:error] ${error.message}`);
    } else if (!suppressedPageErrorNotice) {
      suppressedPageErrorNotice = true;
      console.log("[page:error] further page errors suppressed");
    }
  });

  const extra: Record<string, string> = {
    world: "16",
    clodPerf: "1",
    webgpuSelection: "1",
  };
  if (scene.proceduralDebug) extra["proceduralDebug"] = scene.proceduralDebug;
  const url = clodUrl({
    scene: "infinite-islands",
    seed: 1,
    hud: true,
    freeze: scene.freeze,
    cam: scene.cam,
    extra,
  });

  console.log(`[infinite-accept] ${scene.name}: ${url}`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await Promise.race([waitReady(page, scene.name, failedPath), pageErrorGate]);
    await failOnPageError(page, scene.name, pageErrors, failedPath);
    await Promise.race([settle(page, WARMUP_FRAMES), pageErrorGate]);
    await failOnPageError(page, scene.name, pageErrors, failedPath);
    await Promise.race([settle(page, SAMPLE_FRAMES), pageErrorGate]);
    await failOnPageError(page, scene.name, pageErrors, failedPath);

    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: screenshotPath });

    const stats = await readStats(page);
    const phase0 = await readPhase0Report(page);
    writeJson(statsPath, stats);
    writeJson(phase0Path, phase0);
    if (summaryPath) writeJson(summaryPath, qaSummary("infinite-islands", stats));

    await writeBootstrapDiff(screenshotPath, comparisonPath);
    const imageSanity = await inspectPngSanity(screenshotPath, { width: WIDTH, height: HEIGHT });
    const thresholds: ThresholdEvaluation = evaluateThresholds(extractAcceptanceCounters(stats));
    const failures = [
      ...pageErrors.map((error) => `page error: ${error}`),
      ...thresholds.failures,
      ...imageSanity.failures.map((failure) => `image sanity: ${failure}`),
    ];
    return {
      name: scene.name,
      url,
      screenshot: rel(screenshotPath),
      stats,
      statsPath: rel(statsPath),
      phase0Path: rel(phase0Path),
      summaryPath: summaryPath ? rel(summaryPath) : null,
      comparisonPath: rel(comparisonPath),
      thresholds,
      imageSanity,
      consoleWarnings,
      consoleErrors,
      pageErrors,
      failures,
      passed: failures.length === 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await page.screenshot({ path: failedPath }).catch(() => undefined);
    const stats = { ready: false, error: message };
    writeJson(statsPath, stats);
    writeJson(phase0Path, { available: false, error: message });
    if (summaryPath) writeJson(summaryPath, qaSummary("infinite-islands", stats));
    let imageSanity: ImageSanityResult = {
      passed: false,
      failures: ["screenshot was not captured"],
      width: 0,
      height: 0,
      meanLuma: 0,
      rgbStddev: 0,
      meanAlpha: 0,
    };
    if (existsSync(failedPath)) {
      imageSanity = await inspectPngSanity(failedPath, { width: WIDTH, height: HEIGHT }).catch((sanityError: unknown) => ({
        passed: false,
        failures: [`screenshot sanity failed: ${sanityError instanceof Error ? sanityError.message : String(sanityError)}`],
        width: 0,
        height: 0,
        meanLuma: 0,
        rgbStddev: 0,
        meanAlpha: 0,
      }));
      await writeBootstrapDiff(failedPath, comparisonPath).catch(() => undefined);
    }
    const thresholds = evaluateThresholds({});
    const failures = [
      message,
      ...imageSanity.failures.map((failure) => `image sanity: ${failure}`),
    ];
    return {
      name: scene.name,
      url,
      screenshot: existsSync(failedPath) ? rel(failedPath) : rel(screenshotPath),
      stats,
      statsPath: rel(statsPath),
      phase0Path: rel(phase0Path),
      summaryPath: summaryPath ? rel(summaryPath) : null,
      comparisonPath: rel(comparisonPath),
      thresholds,
      imageSanity,
      consoleWarnings,
      consoleErrors,
      pageErrors,
      failures,
      passed: false,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const timestamp = timestampForFolder();
  const outDir = resolve(RUN_ROOT, timestamp);
  mkdirSync(outDir, { recursive: true });

  console.log(`[infinite-accept] run ${rel(outDir)}`);
  console.log(`[infinite-accept] base ${process.env["CLOD_POC_BASE_URL"]}`);

  const { browser, recipe } = await launchWebGPU();
  const sceneResults: SceneResult[] = [];
  try {
    for (const scene of SCENES) {
      sceneResults.push(await runScene(browser, scene, outDir));
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const failures = sceneResults.flatMap((scene) => scene.failures.map((failure) => `${scene.name}: ${failure}`));
  const passed = aggregatePassed(sceneResults, failures);
  const reportJsonPath = resolve(outDir, "report.json");
  const reportMdPath = resolve(outDir, "report.md");
  const report = {
    passed,
    timestamp,
    commit_sha: gitSha(),
    browser_launch_recipe: recipe,
    thresholds: {
      required_counters: REQUIRED_COUNTERS,
      rules: THRESHOLD_RULES.map((rule) => ({ key: rule.key, label: rule.label })),
    },
    reference_status: "bootstrap",
    failures,
    scenes: sceneResults.map((scene) => ({
      name: scene.name,
      url: scene.url,
      passed: scene.passed,
      failures: scene.failures,
      console_warnings: scene.consoleWarnings,
      console_errors: scene.consoleErrors,
      page_errors: scene.pageErrors,
      thresholds: scene.thresholds,
      image_sanity: scene.imageSanity,
      artifacts: {
        screenshot: scene.screenshot,
        stats_json: scene.statsPath,
        phase0_report_json: scene.phase0Path,
        qa_summary_json: scene.summaryPath,
        visual_comparison: scene.comparisonPath,
      },
    })),
    artifacts: {
      run_dir: rel(outDir),
      report_json: rel(reportJsonPath),
      report_md: rel(reportMdPath),
    },
  };
  writeJson(reportJsonPath, report);
  writeFileSync(reportMdPath, renderMarkdownReport({
    passed,
    scenes: sceneResults,
    failures,
    reportJsonPath: rel(reportJsonPath),
  }));

  console.log(`[infinite-accept] report ${rel(reportJsonPath)}`);
  if (!passed) {
    console.error(`[infinite-accept] FAILED with ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log("[infinite-accept] ok");
}

main().catch((error: unknown) => {
  console.error("[infinite-accept] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
