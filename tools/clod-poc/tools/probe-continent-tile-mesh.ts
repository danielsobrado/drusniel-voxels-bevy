import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clodUrl, launchWebGPU } from "./launch.js";

const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
const fullScene = process.argv.includes("--full");
const { browser } = await launchWebGPU();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
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
    frameP95WithinBudget: (counters.frame_ms_p95 ?? Number.POSITIVE_INFINITY) <= 8,
    zeroTileFailures: (counters.heightfield_tiles_failures_total ?? 0) === 0,
    zeroGpuFailures: (counters.live_clod_stream_gpu_failed_batches ?? 0) === 0,
    zeroWorkerFallbacks: (counters.live_clod_stream_worker_fallback_pages ?? 0) === 0,
  };
  const report = { url, timedOut, errors, checks, result };
  console.log(JSON.stringify(report, null, 2));
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
  }
  if (timedOut || result.error || errors.length > 0 || Object.values(checks).some((passed) => !passed)) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
