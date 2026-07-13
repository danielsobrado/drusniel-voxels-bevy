import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clodUrl, launchWebGPU } from "./launch.js";

const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
const { browser } = await launchWebGPU();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const url = clodUrl({
    scene: "continent", seed: 19, freeze: true,
    extra: {
      world: "8", startupWorld: "2", continentHydrology: "1", gpuTileMesh: "1",
      treeGpu: "0", stoneGpu: "0", understoryGpu: "0", grassGpu: "0", canopy: "0",
    },
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const counters = window.__drusnielClod?.stats?.counters;
    return window.__drusnielClod?.ready === true
      && (counters?.heightfield_tiles_resident ?? 0) > 0
      && (counters?.heightfield_tile_gpu_atlas_resident ?? 0) > 0
      && (counters?.live_clod_stream_gpu_pages_dispatched ?? 0) > 0;
  }, undefined, { timeout: 300_000, polling: 250 });
  const result = await page.evaluate(() => ({
    error: window.__drusnielClod?.error ?? null,
    manifest: window.__drusnielClod?.diag?.worldManifest ?? null,
    startup: window.__drusnielStartupTimings ?? null,
    counters: window.__drusnielClod?.stats?.counters ?? null,
  }));
  const report = { url, errors, result };
  console.log(JSON.stringify(report, null, 2));
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
  }
  if (result.error || errors.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}

