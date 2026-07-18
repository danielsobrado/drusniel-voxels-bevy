import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import type { ContinentRiverCrossingRoute } from "../../src/water/continent_river_route.js";
import { clodUrl } from "../launch.js";
import {
  launchHeadedRealWebGPU,
  type HeadedWebGpuProbe,
} from "./headed_real_webgpu.js";
import {
  PlaywrightDiagnosticSliceDriver,
  PlaywrightPlayableSliceDriver,
  preparePlayableSlicePage,
} from "./playable_slice_playwright_driver.js";
import {
  runContinuousPlayableSlice,
  runDiagnosticPlayableSlice,
} from "./playable_slice_route.js";
import type { PlayableSliceMode, PlayableSliceRunReport } from "./playable_slice_contract.js";
import { planPlayableSliceRoute, type PlayableSliceRoutePlan } from "./playable_slice_route_planner.js";

process.env["CLOD_POC_BASE_URL"] ??= "http://127.0.0.1:5173/";

const DEFAULT_RUNS = 5;
const SEED = 1;
const WORLD_PAGES = 4;
const WIDTH = 1280;
const HEIGHT = 720;
const READY_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 240_000;
const SAVE_DB_NAME = "drusniel-clod-saves";
const CONSTRUCTION_STORAGE_KEY = "drusniel.clod-poc.construction.v1";
const OUT = resolve("acceptance-runs/playable-slice/report.json");
const SHOTS_DIR = resolve("acceptance-runs/playable-slice/shots");

interface DiscoveryResult {
  route: ContinentRiverCrossingRoute;
  plan: PlayableSliceRoutePlan;
}

interface PlayableSliceAcceptanceReport {
  schemaVersion: 1;
  generatedAt: string;
  scene: "continent";
  seed: number;
  configuredRuns: number;
  gpu: HeadedWebGpuProbe;
  route: DiscoveryResult;
  runs: PlayableSliceRunReport[];
  passed: boolean;
}

function optionValue(prefix: string): string | null {
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
}

function requestedRuns(): number {
  const value = Number(optionValue("--runs="));
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_RUNS;
}

function requestedModes(): PlayableSliceMode[] {
  const mode = optionValue("--mode=");
  if (mode === "diagnostic" || mode === "continuous") return [mode];
  return ["diagnostic", "continuous"];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function expectedWaterBodyId(route: DiscoveryResult): string {
  return `hydrology:${route.route.riverBodyId}`;
}

async function withTimeout<T>(label: string, operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForDiagnosticReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const hooks = window.__drusnielClod;
      return Boolean(hooks && (hooks.ready || hooks.error !== null));
    },
    undefined,
    { timeout: READY_TIMEOUT_MS, polling: 100 },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(error);
}

async function resetRunStorageAndSeedSave(page: Page, saveId: string): Promise<void> {
  await page.evaluate(async ({ constructionStorageKey, dbName, id, seed }) => {
    localStorage.removeItem(constructionStorageKey);
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(`save database ${dbName} deletion was blocked`));
    });

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        for (const name of ["manifests", "regions", "metadata"]) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["manifests", "metadata"], "readwrite");
        const now = new Date().toISOString();
        tx.objectStore("manifests").put({
          schemaVersion: 1,
          saveId: id,
          worldId: `playable-slice:${seed}`,
          seed,
          proceduralProfile: "continent-v1",
          regionSizeM: 512,
          chunkSizeM: 16,
          regionKeys: [],
          createdAt: now,
          updatedAt: now,
        }, id);
        tx.objectStore("metadata").put({
          schemaVersion: 1,
          cities: [],
          districts: [],
          roads: [],
          caveEntrances: [],
          caveSystems: [],
          criticalPaths: [],
          revision: 0,
        }, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, {
    constructionStorageKey: CONSTRUCTION_STORAGE_KEY,
    dbName: SAVE_DB_NAME,
    id: saveId,
    seed: SEED,
  });
}

function baseExtra(saveId?: string): Record<string, string> {
  return {
    acceptance: "1",
    world: String(WORLD_PAGES),
    hud: "1",
    liveBubble: "1",
    liveBubbleRadius: "200",
    liveBubbleColliderRadius: "160",
    liveClodRootRadius: "384",
    farClipmap: "1",
    farClipmapMode: "replace",
    ...(saveId ? { save: saveId } : {}),
  };
}

async function discoverRoute(context: BrowserContext): Promise<DiscoveryResult> {
  const page = await context.newPage();
  try {
    await page.goto(clodUrl({ scene: "continent", seed: SEED, hud: true, extra: baseExtra() }), {
      waitUntil: "domcontentloaded",
      timeout: READY_TIMEOUT_MS,
    });
    await waitForDiagnosticReady(page);
    const discovery = await page.evaluate(() => {
      const hook = window.__drusnielClod?.findContinentRiverCrossingRoute;
      const snapshot = window.__drusnielClod?.getPlayableSliceSnapshot?.();
      if (!hook || !snapshot) throw new Error("continent route or playable snapshot hook is unavailable");
      const centers = [
        [2048, 2048],
        [1024, 1024],
        [3072, 3072],
        [1024, 3072],
        [3072, 1024],
      ] as const;
      return {
        pageSizeM: snapshot.pageSizeM,
        routes: centers.flatMap(([centerX, centerZ]) => {
          const route = hook({
            centerX,
            centerZ,
            searchRadiusM: 768,
            searchSpacingM: 16,
            crossingHalfSpanM: 192,
          });
          return route ? [route] : [];
        }),
      };
    });
    for (const route of discovery.routes) {
      try {
        return { route, plan: planPlayableSliceRoute(route, discovery.pageSizeM) };
      } catch {
        // Try the next deterministic search center.
      }
    }
    throw new Error(`no river approach can exercise a ${discovery.pageSizeM}m page boundary before water`);
  } finally {
    await page.close();
  }
}

function gameplayUrl(saveId: string, plan: PlayableSliceRoutePlan): string {
  return clodUrl({
    scene: "continent",
    seed: SEED,
    hud: true,
    extra: {
      ...baseExtra(saveId),
      x: String(plan.spawn[0]),
      z: String(plan.spawn[1]),
      yaw: String(plan.yaw),
    },
  });
}

function attachPageLogging(page: Page, label: string): void {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.log(`[${label}:${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => console.error(`[${label}:pageerror] ${error.message}`));
}

function failedRunReport(
  mode: PlayableSliceMode,
  runIndex: number,
  freshProfile: boolean,
  waterBodyId: string,
  startedAt: Date,
  startedAtMs: number,
  driver: PlaywrightPlayableSliceDriver | null,
  error: unknown,
): PlayableSliceRunReport {
  return {
    schemaVersion: 1,
    mode,
    runIndex,
    freshProfile,
    expectedWaterBodyId: waterBodyId,
    startedAt: startedAt.toISOString(),
    wallClockMs: Math.max(0, performance.now() - startedAtMs),
    actions: driver ? [...driver.actions] : [],
    steps: driver ? [...driver.evidence] : [],
    maxFrameMs: driver?.maxFrameMs ?? 0,
    maxFrameP95Ms: driver?.maxFrameP95Ms ?? 0,
    travelledAfterReloadM: 0,
    passed: false,
    failures: [errorMessage(error)],
  };
}

async function captureRunScreenshot(
  page: Page,
  mode: PlayableSliceMode,
  runIndex: number,
  freshProfile: boolean,
): Promise<void> {
  if (page.isClosed()) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  try {
    await page.screenshot({
      path: resolve(SHOTS_DIR, `${mode}-${freshProfile ? "fresh" : "repeat"}-${runIndex}.png`),
      fullPage: false,
    });
  } catch (error) {
    console.error(`[playable-slice] screenshot failed: ${errorMessage(error)}`);
  }
}

async function runOne(
  context: BrowserContext,
  mode: PlayableSliceMode,
  runIndex: number,
  freshProfile: boolean,
  route: DiscoveryResult,
): Promise<PlayableSliceRunReport> {
  const saveId = `playable-slice-${mode}-${freshProfile ? "fresh" : "repeat"}-${runIndex}`;
  const waterBodyId = expectedWaterBodyId(route);
  const page = await context.newPage();
  const startedAt = new Date();
  const startedAtMs = performance.now();
  let driver: PlaywrightPlayableSliceDriver | null = null;
  attachPageLogging(page, `${mode}-${runIndex}`);
  try {
    await page.goto(clodUrl({ scene: "continent", seed: SEED, extra: baseExtra() }), {
      waitUntil: "domcontentloaded",
      timeout: READY_TIMEOUT_MS,
    });
    await resetRunStorageAndSeedSave(page, saveId);
    await page.goto(gameplayUrl(saveId, route.plan), {
      waitUntil: "domcontentloaded",
      timeout: READY_TIMEOUT_MS,
    });
    await preparePlayableSlicePage(page);

    driver = mode === "diagnostic"
      ? new PlaywrightDiagnosticSliceDriver(page)
      : new PlaywrightPlayableSliceDriver(page);
    await driver.prepareDownwardAim();
    const routeRun = mode === "diagnostic"
      ? runDiagnosticPlayableSlice(driver as PlaywrightDiagnosticSliceDriver, {
          runIndex,
          freshProfile,
          expectedWaterBodyId: waterBodyId,
          startedAt,
        })
      : runContinuousPlayableSlice(driver, {
          runIndex,
          freshProfile,
          expectedWaterBodyId: waterBodyId,
          startedAt,
        });
    return await withTimeout(`${mode} playable route`, routeRun, RUN_TIMEOUT_MS);
  } catch (error) {
    return failedRunReport(mode, runIndex, freshProfile, waterBodyId, startedAt, startedAtMs, driver, error);
  } finally {
    await captureRunScreenshot(page, mode, runIndex, freshProfile);
    await page.close();
  }
}

async function runRepeatedProfile(
  browser: Browser,
  route: DiscoveryResult,
  modes: readonly PlayableSliceMode[],
  runs: number,
): Promise<PlayableSliceRunReport[]> {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  try {
    const reports: PlayableSliceRunReport[] = [];
    for (const mode of modes) {
      for (let runIndex = 0; runIndex < runs; runIndex++) {
        console.log(`[playable-slice] ${mode} repeated run ${runIndex + 1}/${runs}`);
        reports.push(await runOne(context, mode, runIndex, false, route));
      }
    }
    return reports;
  } finally {
    await context.close();
  }
}

async function runFreshProfile(
  browser: Browser,
  route: DiscoveryResult,
  enabled: boolean,
): Promise<PlayableSliceRunReport[]> {
  if (!enabled) return [];
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  try {
    console.log("[playable-slice] continuous fresh-profile run");
    return [await runOne(context, "continuous", 0, true, route)];
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  rmSync(OUT, { force: true });
  rmSync(SHOTS_DIR, { recursive: true, force: true });
  const runs = requestedRuns();
  const modes = requestedModes();
  const { browser, probe } = await launchHeadedRealWebGPU();
  try {
    const discoveryContext = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    let route: DiscoveryResult;
    try {
      route = await discoverRoute(discoveryContext);
    } finally {
      await discoveryContext.close();
    }
    console.log(`[playable-slice] route ${JSON.stringify(route)}`);

    const repeated = await runRepeatedProfile(browser, route, modes, runs);
    const fresh = await runFreshProfile(browser, route, modes.includes("continuous"));
    const allRuns = [...repeated, ...fresh];
    const report: PlayableSliceAcceptanceReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scene: "continent",
      seed: SEED,
      configuredRuns: runs,
      gpu: probe,
      route,
      runs: allRuns,
      passed: allRuns.length > 0 && allRuns.every((run) => run.passed),
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) {
      const failures = allRuns.flatMap((run) => run.failures.map(
        (failure) => `${run.mode}[${run.freshProfile ? "fresh" : "repeat"}:${run.runIndex}]: ${failure}`,
      ));
      throw new Error(`playable slice failed:\n${failures.join("\n")}`);
    }
    console.log(`[playable-slice] PASS ${OUT}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
