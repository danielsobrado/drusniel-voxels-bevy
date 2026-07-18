import { resolve } from "node:path";
import type { BrowserContext, Page } from "playwright";
import {
  PLAYABLE_SLICE_READY_TIMEOUT_MS,
  PLAYABLE_SLICE_SHOTS_DIR,
  playableSliceDiscoveryUrl,
} from "./playable_slice_acceptance_environment.js";
import {
  capturePlayableSliceScreenshot,
  closePlayableSlicePageBestEffort,
} from "./playable_slice_acceptance_io.js";
import type { PlayableSliceDiscoveryResult } from "./playable_slice_acceptance_types.js";
import { planPlayableSliceRoute } from "./playable_slice_route_planner.js";

async function waitForDiagnosticReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const hooks = window.__drusnielClod;
      return Boolean(hooks && (hooks.ready || hooks.error !== null));
    },
    undefined,
    { timeout: PLAYABLE_SLICE_READY_TIMEOUT_MS, polling: 100 },
  );
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(error);
}

export async function discoverPlayableSliceRoute(
  context: BrowserContext,
): Promise<PlayableSliceDiscoveryResult> {
  const page = await context.newPage();
  let failed = false;
  try {
    await page.goto(playableSliceDiscoveryUrl(), {
      waitUntil: "domcontentloaded",
      timeout: PLAYABLE_SLICE_READY_TIMEOUT_MS,
    });
    await waitForDiagnosticReady(page);
    const discovery = await page.evaluate(() => {
      const hook = window.__drusnielClod?.findContinentRiverCrossingRoute;
      const snapshot = window.__drusnielClod?.getPlayableSliceSnapshot?.();
      const worldManifest = window.__drusnielWorldManifest;
      if (!hook || !snapshot || !worldManifest) {
        throw new Error("continent route, playable snapshot, or world manifest hook is unavailable");
      }
      const centers = [
        [2048, 2048],
        [1024, 1024],
        [3072, 3072],
        [1024, 3072],
        [3072, 1024],
      ] as const;
      return {
        pageSizeM: snapshot.pageSizeM,
        worldManifest: structuredClone(worldManifest),
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
        return {
          route,
          plan: planPlayableSliceRoute(route, discovery.pageSizeM),
          worldManifest: discovery.worldManifest,
        };
      } catch {
        // Try the next deterministic search center.
      }
    }
    throw new Error(`no river approach can exercise a ${discovery.pageSizeM}m page boundary before water`);
  } catch (error) {
    failed = true;
    await capturePlayableSliceScreenshot(
      page,
      resolve(PLAYABLE_SLICE_SHOTS_DIR, "discovery-failed.png"),
      "discovery",
    );
    throw error;
  } finally {
    await closePlayableSlicePageBestEffort(page, failed ? "failed discovery" : "discovery");
  }
}
