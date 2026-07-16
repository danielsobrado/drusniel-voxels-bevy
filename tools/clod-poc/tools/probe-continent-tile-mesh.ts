import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clodUrl, launchWebGPU } from "./launch.js";
import { INFINITE_ISLANDS_FRAME_MS_P95_MAX } from "./infinite_acceptance/thresholds.js";

const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
const fullScene = process.argv.includes("--full");
const routeRequested = process.argv.includes("--route");
const { browser } = await launchWebGPU();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });
  const url = clodUrl({
    scene: "continent", seed: 19, freeze: true,
    extra: fullScene
      ? { world: "8", startupWorld: "2" }
      : { world: "8", startupWorld: "2", trees: "0", treeGpu: "0", stoneGpu: "0", understoryGpu: "0", grassGpu: "0", canopy: "0" },
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  let timedOut = false;
  await page.waitForFunction(() => {
    const counters = window.__drusnielClod?.stats?.counters;
    return (window.__drusnielClod?.ready === true
      && (counters?.heightfield_tiles_resident ?? 0) > 0
      && (counters?.heightfield_tile_gpu_atlas_resident ?? 0) > 0
      && (counters?.live_clod_stream_gpu_pages_dispatched ?? 0) > 0)
      || window.__drusnielClod?.error != null
      || (counters?.live_clod_stream_gpu_failed_batches ?? 0) > 0
      || (counters?.live_clod_stream_worker_fallback_pages ?? 0) > 0
      || (counters?.heightfield_tiles_failures_total ?? 0) > 0;
  }, undefined, { timeout: 120_000, polling: 250 }).catch(() => { timedOut = true; });
  const routeEvidence = routeRequested ? await page.evaluate(async () => {
    const hooks = window.__drusnielClod;
    const route = hooks?.findContinentRiverCrossingRoute?.({
      centerX: 2048,
      centerZ: 2048,
      searchRadiusM: 1024,
      searchSpacingM: 16,
      crossingHalfSpanM: 64,
    }) ?? null;
    const pose = hooks?.getPose?.();
    if (!hooks || !route || !pose || !hooks.setPose || !hooks.settle || !hooks.beginMovementRouteProbe) {
      return { route, error: "continent river route automation hooks are unavailable", counters: null };
    }
    hooks.flyCamEnabled?.(false);
    const cameraY = Math.max(pose.p[1], route.centerWaterY + 96);
    hooks.setPose({ ...pose, p: [route.start[0], cameraY, route.start[1]] });
    await hooks.settle(180);
    hooks.beginMovementRouteProbe();
    const steps = 8;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      hooks.setPose({
        ...pose,
        p: [
          route.start[0] + (route.end[0] - route.start[0]) * t,
          cameraY,
          route.start[1] + (route.end[1] - route.start[1]) * t,
        ],
      });
      await hooks.settle(45);
    }
    await hooks.settle(180);
    return {
      route,
      error: null,
      counters: { ...(hooks.stats?.counters ?? {}) },
    };
  }) : null;
  const result = await page.evaluate(() => ({
    error: window.__drusnielClod?.error ?? null,
    manifest: window.__drusnielClod?.diag?.worldManifest ?? null,
    startup: window.__drusnielStartupTimings ?? null,
    counters: window.__drusnielClod?.stats?.counters ?? null,
  }));
  const counters = result.counters ?? {};
  const checks = {
    graphPresent: result.startup?.["hydrology_graph_present"] === 1,
    atlasResident: (counters.heightfield_tile_gpu_atlas_resident ?? 0) > 0,
    gpuPageDispatched: (counters.live_clod_stream_gpu_pages_dispatched ?? 0) > 0,
    waitingOnTilesBounded: (counters.live_clod_stream_waiting_on_tiles ?? 0) <= 128,
    frameP95WithinBudget: (counters.frame_ms_p95 ?? Number.POSITIVE_INFINITY) <= INFINITE_ISLANDS_FRAME_MS_P95_MAX,
    zeroTileFailures: (counters.heightfield_tiles_failures_total ?? 0) === 0,
    zeroGpuFailures: (counters.live_clod_stream_gpu_failed_batches ?? 0) === 0,
    zeroWorkerFallbacks: (counters.live_clod_stream_worker_fallback_pages ?? 0) === 0,
    ...routeRequested ? {
      routeFound: routeEvidence?.route != null,
      routeHasCarvedDepth: (routeEvidence?.route?.centerDepthM ?? 0) > 0,
      routeStreamedPages: (routeEvidence?.counters?.live_clod_stream_probe_apply_pages_total ?? 0) > 0,
      routeFrameP95WithinBudget: (routeEvidence?.counters?.frame_ms_p95 ?? Number.POSITIVE_INFINITY) <= INFINITE_ISLANDS_FRAME_MS_P95_MAX,
      routeZeroGpuFailures: (routeEvidence?.counters?.live_clod_stream_gpu_failed_batches ?? 0) === 0,
      routeZeroWorkerFallbacks: (routeEvidence?.counters?.live_clod_stream_worker_fallback_pages ?? 0) === 0,
    } : {},
  };
  const report = { url, timedOut, errors, warnings, checks, routeEvidence, result };
  console.log(JSON.stringify(report, null, 2));
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
  }
  if (timedOut || result.error || routeEvidence?.error || errors.length > 0
    || Object.values(checks).some((passed) => !passed)) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
