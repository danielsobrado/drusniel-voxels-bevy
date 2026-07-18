import { rmSync } from "node:fs";
import type { Browser } from "playwright";
import {
  launchHeadedRealWebGPU,
  type HeadedWebGpuProbe,
} from "./headed_real_webgpu.js";
import { parsePlayableSliceAcceptanceConfig } from "./playable_slice_acceptance_config.js";
import {
  PLAYABLE_SLICE_HEIGHT,
  PLAYABLE_SLICE_OUT,
  PLAYABLE_SLICE_SEED,
  PLAYABLE_SLICE_SHOTS_DIR,
  PLAYABLE_SLICE_WIDTH,
} from "./playable_slice_acceptance_environment.js";
import { discoverPlayableSliceRoute } from "./playable_slice_acceptance_discovery.js";
import {
  closePlayableSliceContextBestEffort,
  playableSliceErrorMessage,
  writePlayableSliceAcceptanceReport,
} from "./playable_slice_acceptance_io.js";
import { runPlayableSliceProfiles } from "./playable_slice_acceptance_runs.js";
import type {
  PlayableSliceAcceptanceReport,
  PlayableSliceDiscoveryResult,
} from "./playable_slice_acceptance_types.js";
import type { PlayableSliceMode, PlayableSliceRunReport } from "./playable_slice_contract.js";

process.env["CLOD_POC_BASE_URL"] ??= "http://127.0.0.1:5173/";

async function main(): Promise<void> {
  rmSync(PLAYABLE_SLICE_OUT, { force: true });
  rmSync(PLAYABLE_SLICE_SHOTS_DIR, { recursive: true, force: true });

  let configuredRuns = 0;
  let configuredModes: readonly PlayableSliceMode[] = [];
  let browser: Browser | null = null;
  let gpu: HeadedWebGpuProbe | null = null;
  let route: PlayableSliceDiscoveryResult | null = null;
  const runs: PlayableSliceRunReport[] = [];
  const failures: string[] = [];
  let report: PlayableSliceAcceptanceReport | null = null;

  try {
    const config = parsePlayableSliceAcceptanceConfig(process.argv.slice(2));
    configuredRuns = config.runs;
    configuredModes = config.modes;

    const launched = await launchHeadedRealWebGPU();
    const activeBrowser = launched.browser;
    browser = activeBrowser;
    gpu = launched.probe;

    const discoveryContext = await activeBrowser.newContext({
      viewport: { width: PLAYABLE_SLICE_WIDTH, height: PLAYABLE_SLICE_HEIGHT },
    });
    let discoveredRoute: PlayableSliceDiscoveryResult;
    try {
      discoveredRoute = await discoverPlayableSliceRoute(discoveryContext);
      route = discoveredRoute;
    } finally {
      const closeFailure = await closePlayableSliceContextBestEffort(discoveryContext, "discovery");
      if (closeFailure) failures.push(closeFailure);
    }
    console.log(`[playable-slice] route ${JSON.stringify(discoveredRoute)}`);

    const profileResult = await runPlayableSliceProfiles(
      activeBrowser,
      discoveredRoute,
      configuredModes,
      configuredRuns,
    );
    runs.push(...profileResult.runs);
    failures.push(...profileResult.failures);
  } catch (error) {
    failures.push(playableSliceErrorMessage(error));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        failures.push(`browser close failed: ${playableSliceErrorMessage(error)}`);
      }
    }

    const expectedRunCount = configuredRuns * configuredModes.length
      + (configuredModes.includes("continuous") ? 1 : 0);
    if (runs.length !== expectedRunCount) {
      failures.push(`completed ${runs.length} runs, expected ${expectedRunCount}`);
    }
    failures.push(...runs.flatMap((run) => run.failures.map(
      (failure) => `${run.mode}[${run.freshProfile ? "fresh" : "repeat"}:${run.runIndex}]: ${failure}`,
    )));

    report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scene: "continent",
      seed: PLAYABLE_SLICE_SEED,
      configuredRuns,
      configuredModes,
      expectedRunCount,
      gpu,
      route,
      runs,
      passed: failures.length === 0
        && gpu !== null
        && route !== null
        && runs.length > 0
        && runs.every((run) => run.passed),
      failures,
    };
    writePlayableSliceAcceptanceReport(PLAYABLE_SLICE_OUT, report);
  }

  if (!report) throw new Error("playable slice report was not produced");
  if (!report.passed) throw new Error(`playable slice failed:\n${report.failures.join("\n")}`);
  console.log(`[playable-slice] PASS ${PLAYABLE_SLICE_OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
