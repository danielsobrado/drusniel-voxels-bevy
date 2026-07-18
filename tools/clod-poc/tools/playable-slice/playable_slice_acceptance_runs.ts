import { resolve } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  PLAYABLE_SLICE_HEIGHT,
  PLAYABLE_SLICE_READY_TIMEOUT_MS,
  PLAYABLE_SLICE_RUN_TIMEOUT_MS,
  PLAYABLE_SLICE_SHOTS_DIR,
  PLAYABLE_SLICE_WIDTH,
  playableSliceGameplayUrl,
  playableSliceSetupUrl,
} from "./playable_slice_acceptance_environment.js";
import {
  capturePlayableSliceScreenshot,
  closePlayableSliceContextBestEffort,
  closePlayableSlicePageBestEffort,
  playableSliceErrorMessage,
} from "./playable_slice_acceptance_io.js";
import { resetPlayableSliceStorageAndSeedSave } from "./playable_slice_acceptance_storage.js";
import type { PlayableSliceDiscoveryResult } from "./playable_slice_acceptance_types.js";
import {
  PlaywrightDiagnosticSliceDriver,
  PlaywrightPlayableSliceDriver,
  preparePlayableSlicePage,
} from "./playable_slice_playwright_driver.js";
import { playableSliceCertificationIntegrityFailures } from "./playable_slice_certification_integrity.js";
import {
  finalizePlayableSliceRun,
  type PlayableSliceMode,
  type PlayableSliceRunReport,
} from "./playable_slice_contract.js";
import {
  runContinuousPlayableSlice,
  runDiagnosticPlayableSlice,
} from "./playable_slice_route.js";

export interface PlayableSliceProfileRunResult {
  readonly runs: PlayableSliceRunReport[];
  readonly failures: string[];
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

function expectedWaterBodyId(route: PlayableSliceDiscoveryResult): string {
  return `hydrology:${route.route.riverBodyId}`;
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
    failures: [playableSliceErrorMessage(error)],
  };
}

function revalidateFinalFrameMetrics(
  report: PlayableSliceRunReport,
  driver: PlaywrightPlayableSliceDriver,
): PlayableSliceRunReport {
  const { passed: _passed, failures: _failures, ...base } = report;
  const evaluated = finalizePlayableSliceRun({
    ...base,
    maxFrameMs: driver.maxFrameMs,
    maxFrameP95Ms: driver.maxFrameP95Ms,
  });
  const certificationFailures = playableSliceCertificationIntegrityFailures(evaluated);
  if (certificationFailures.length === 0) return evaluated;
  return {
    ...evaluated,
    passed: false,
    failures: [...evaluated.failures, ...certificationFailures],
  };
}

async function runOne(
  context: BrowserContext,
  mode: PlayableSliceMode,
  runIndex: number,
  freshProfile: boolean,
  route: PlayableSliceDiscoveryResult,
): Promise<PlayableSliceRunReport> {
  const saveId = `playable-slice-${mode}-${freshProfile ? "fresh" : "repeat"}-${runIndex}`;
  const waterBodyId = expectedWaterBodyId(route);
  const page = await context.newPage();
  const startedAt = new Date();
  const startedAtMs = performance.now();
  let driver: PlaywrightPlayableSliceDriver | null = null;
  attachPageLogging(page, `${mode}-${runIndex}`);

  try {
    await page.goto(playableSliceSetupUrl(), {
      waitUntil: "domcontentloaded",
      timeout: PLAYABLE_SLICE_READY_TIMEOUT_MS,
    });
    await resetPlayableSliceStorageAndSeedSave(page, saveId, route.worldManifest);
    await page.goto(playableSliceGameplayUrl(saveId, route.plan), {
      waitUntil: "domcontentloaded",
      timeout: PLAYABLE_SLICE_READY_TIMEOUT_MS,
    });
    await preparePlayableSlicePage(page);

    driver = mode === "diagnostic"
      ? new PlaywrightDiagnosticSliceDriver(page)
      : new PlaywrightPlayableSliceDriver(page);
    await driver.prepareDownwardAim();
    const operation = mode === "diagnostic"
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
    const report = await withTimeout(`${mode} playable route`, operation, PLAYABLE_SLICE_RUN_TIMEOUT_MS);
    await driver.collectFrameMetrics();
    return revalidateFinalFrameMetrics(report, driver);
  } catch (error) {
    if (driver && !page.isClosed()) {
      try {
        await driver.collectFrameMetrics();
      } catch (metricsError) {
        console.error(`[playable-slice] final frame collection failed: ${playableSliceErrorMessage(metricsError)}`);
      }
    }
    return failedRunReport(mode, runIndex, freshProfile, waterBodyId, startedAt, startedAtMs, driver, error);
  } finally {
    await capturePlayableSliceScreenshot(
      page,
      resolve(PLAYABLE_SLICE_SHOTS_DIR, `${mode}-${freshProfile ? "fresh" : "repeat"}-${runIndex}.png`),
      `${mode} run ${runIndex}`,
    );
    await closePlayableSlicePageBestEffort(page, `${mode} run ${runIndex}`);
  }
}

async function runRepeatedProfile(
  browser: Browser,
  route: PlayableSliceDiscoveryResult,
  modes: readonly PlayableSliceMode[],
  runs: number,
): Promise<PlayableSliceProfileRunResult> {
  let context: BrowserContext | null = null;
  const reports: PlayableSliceRunReport[] = [];
  const failures: string[] = [];
  try {
    context = await browser.newContext({
      viewport: { width: PLAYABLE_SLICE_WIDTH, height: PLAYABLE_SLICE_HEIGHT },
    });
    for (const mode of modes) {
      for (let runIndex = 0; runIndex < runs; runIndex++) {
        console.log(`[playable-slice] ${mode} repeated run ${runIndex + 1}/${runs}`);
        reports.push(await runOne(context, mode, runIndex, false, route));
      }
    }
  } catch (error) {
    failures.push(`repeated profile aborted: ${playableSliceErrorMessage(error)}`);
  } finally {
    if (context) {
      const closeFailure = await closePlayableSliceContextBestEffort(context, "repeated profile");
      if (closeFailure) failures.push(closeFailure);
    }
  }
  return { runs: reports, failures };
}

async function runFreshProfile(
  browser: Browser,
  route: PlayableSliceDiscoveryResult,
  enabled: boolean,
): Promise<PlayableSliceProfileRunResult> {
  if (!enabled) return { runs: [], failures: [] };
  let context: BrowserContext | null = null;
  const reports: PlayableSliceRunReport[] = [];
  const failures: string[] = [];
  try {
    context = await browser.newContext({
      viewport: { width: PLAYABLE_SLICE_WIDTH, height: PLAYABLE_SLICE_HEIGHT },
    });
    console.log("[playable-slice] continuous fresh-profile run");
    reports.push(await runOne(context, "continuous", 0, true, route));
  } catch (error) {
    failures.push(`fresh profile aborted: ${playableSliceErrorMessage(error)}`);
  } finally {
    if (context) {
      const closeFailure = await closePlayableSliceContextBestEffort(context, "fresh profile");
      if (closeFailure) failures.push(closeFailure);
    }
  }
  return { runs: reports, failures };
}

export async function runPlayableSliceProfiles(
  browser: Browser,
  route: PlayableSliceDiscoveryResult,
  modes: readonly PlayableSliceMode[],
  runs: number,
): Promise<PlayableSliceProfileRunResult> {
  const repeated = await runRepeatedProfile(browser, route, modes, runs);
  const fresh = await runFreshProfile(browser, route, modes.includes("continuous"));
  return {
    runs: [...repeated.runs, ...fresh.runs],
    failures: [...repeated.failures, ...fresh.failures],
  };
}
