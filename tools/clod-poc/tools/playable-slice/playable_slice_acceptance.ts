import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import type { ContinentRiverCrossingRoute } from "../../src/water/continent_river_route.js";
import { clodUrl, launchWebGPU } from "../launch.js";
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
    () => window.__drusnielClod?.ready === true || window.__drusnielClod?.error !== null,
    undefined,
    { timeout: READY_TIMEOUT_MS, polling: 100 },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(error);
}

async function seedEmptySave(page: Page, saveId: string): Promise<void> {
  await page.evaluate(async ({ id, seed }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("drusniel-clod-saves", 1);
      request.onupgradeneeded = () => {
        for (const name of ["manifests", "regions", "metadata"]) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["manifests", "metadata"], "readwrite");
      const now = new Date().toISOString();
      tx.objectStore("manifests").put({
        schemaVersion: 1,
        saveId: id,
        worldId: `playable-slice:${seed}`,
        seed,
        proceduralProfile: "infinite-islands-v1",
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
    db.close();
  }, { id: saveId, seed: SEED });
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

async function runOne(
  context: BrowserContext,
  mode: PlayableSliceMode,
  runIndex: number,
  freshProfile: boolean,
  route: DiscoveryResult,
): Promise<PlayableSliceRunReport> {
  const saveId = `playable-slice-${mode}-${freshProfile ? "fresh" : "repeat"}-${runIndex}`;
  const page = await context.newPage();
  attachPageLogging(page, `${mode}-${runIndex}`);
  try {
    await page.goto(clodUrl({ scene: "continent", seed: SEED, extra: baseExtra() }), {
      waitUntil: "domcontentloaded",
      timeout: READY_TIMEOUT_MS,
    });
    await seedEmptySave(page, saveId);
    await page.goto(gameplayUrl(saveId, route.plan), {
      waitUntil: "domcontentloaded",
      timeout: READY_TIMEOUT_MS,
    });
    await preparePlayableSlicePage(page);

    const driver = mode === "diagnostic"
      ? new PlaywrightDiagnosticSliceDriver(page)
      : new PlaywrightPlayableSliceDriver(page);
    await driver.prepareDownwardAim();
    const report = mode === "diagnostic"
      ? await runDiagnosticPlayableSlice(driver as PlaywrightDiagnosticSliceDriver, { runIndex, freshProfile })
      : await runContinuousPlayableSlice(driver, { runIndex, freshProfile });

    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({
      path: resolve(SHOTS_DIR, `${mode}-${freshProfile ? "fresh" : "repeat"}-${runIndex}.png`),
      fullPage: false,
    });
    return report;
  } finally {
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
        reports.push(await withTimeout(
          `${mode} run ${runIndex + 1}`,
          runOne(context, mode, runIndex, false, route),
          RUN_TIMEOUT_MS,
        ));
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
    return [await withTimeout(
      "continuous fresh-profile run",
      runOne(context, "continuous", 0, true, route),
      RUN_TIMEOUT_MS,
    )];
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const runs = requestedRuns();
  const modes = requestedModes();
  const { browser } = await launchWebGPU();
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
      route,
      runs: allRuns,
      passed: allRuns.length > 0 && allRuns.every((run) => run.passed),
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) {
      const failures = allRuns.flatMap((run) => run.failures.map((failure) => `${run.mode}[${run.runIndex}]: ${failure}`));
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
