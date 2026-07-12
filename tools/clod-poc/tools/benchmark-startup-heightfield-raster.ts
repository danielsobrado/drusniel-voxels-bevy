import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Browser } from "playwright";
import { clodUrl, launchChromium } from "./launch.js";

const DEFAULT_WORLD_PAGES = [4, 8, 16, 32] as const;
const DEFAULT_TIMEOUT_MS = 360_000;

type JsonRecord = Record<string, unknown>;

interface RunResult {
  label: string;
  worldPages: number;
  url: string;
  elapsedMs: number;
  startupTimings: Record<string, number>;
}

function parseWorldPages(argv: readonly string[]): number[] {
  const arg = argv.find((value) => value.startsWith("--worlds="));
  if (!arg) return [...DEFAULT_WORLD_PAGES];
  const values = arg.slice("--worlds=".length)
    .split(",")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);
  if (values.length === 0) throw new Error("--worlds must contain positive integer page counts");
  return values;
}

function timeoutMs(argv: readonly string[]): number {
  const arg = argv.find((value) => value.startsWith("--timeout="));
  const value = arg ? Number(arg.slice("--timeout=".length)) : DEFAULT_TIMEOUT_MS;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function outputPath(argv: readonly string[]): string {
  const arg = argv.find((value) => value.startsWith("--out="));
  return resolve(arg?.slice("--out=".length) || `perf-runs/startup-heightfield-raster/${Date.now()}-summary.json`);
}

async function runStartup(
  browser: Browser,
  worldPages: number,
  cache: "0" | "1",
  label: string,
  timeout: number,
): Promise<RunResult> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const url = clodUrl({
    scene: "infinite-islands",
    seed: 1,
    hud: false,
    extra: {
      world: String(worldPages),
      startupWorld: String(worldPages),
      infiniteStartupWorld: String(worldPages),
      cache,
      hydroUnified: "1",
      heightfieldRaster: "1",
      farClipmap: "0",
      canopy: "0",
    },
  });
  const startedAt = performance.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.__drusnielClod && (window.__drusnielClod.ready || window.__drusnielClod.error !== null),
      undefined,
      { timeout, polling: 250 },
    );
    const payload = await page.evaluate(() => ({
      error: window.__drusnielClod?.error ?? null,
      startupTimings: window.__drusnielClod?.startupTimings ?? window.__drusnielStartupTimings ?? {},
    })) as { error: unknown; startupTimings: Record<string, number> };
    if (payload.error) throw new Error(String(payload.error));
    return {
      label,
      worldPages,
      url,
      elapsedMs: performance.now() - startedAt,
      startupTimings: payload.startupTimings,
    };
  } finally {
    await page.close();
  }
}

function metric(result: RunResult, key: string): number {
  const value = result.startupTimings[key];
  return Number.isFinite(value) ? value : 0;
}

function summaryRow(cold: RunResult, warm: RunResult): JsonRecord {
  return {
    worldPages: cold.worldPages,
    coldElapsedMs: cold.elapsedMs,
    warmElapsedMs: warm.elapsedMs,
    coldBuildWorldMs: metric(cold, "startup.build_world_ms"),
    warmBuildWorldMs: metric(warm, "startup.build_world_ms"),
    coldRasterEnabled: metric(cold, "startup.heightfield_raster_enabled"),
    warmRasterEnabled: metric(warm, "startup.heightfield_raster_enabled"),
    coldRasterMs: metric(cold, "startup.heightfield_raster_ms"),
    warmRasterMs: metric(warm, "startup.heightfield_raster_ms"),
    rasterSamples: metric(warm, "startup.heightfield_raster_samples") || metric(cold, "startup.heightfield_raster_samples"),
    rasterBytes: metric(warm, "startup.heightfield_raster_bytes") || metric(cold, "startup.heightfield_raster_bytes"),
    workerCloneMs: metric(warm, "startup.heightfield_raster_worker_clone_ms") || metric(cold, "startup.heightfield_raster_worker_clone_ms"),
    workerTransferMs: metric(warm, "startup.heightfield_raster_worker_transfer_ms") || metric(cold, "startup.heightfield_raster_worker_transfer_ms"),
    cacheHit: metric(warm, "clod_cache_hit"),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const worlds = parseWorldPages(argv);
  const timeout = timeoutMs(argv);
  const out = outputPath(argv);
  const { browser, recipe } = await launchChromium();
  const runs: RunResult[] = [];
  try {
    for (const worldPages of worlds) {
      console.log(`[heightfield-bench] world=${worldPages}: cold cache-disabled run`);
      const cold = await runStartup(browser, worldPages, "0", "cold", timeout);
      runs.push(cold);

      console.log(`[heightfield-bench] world=${worldPages}: priming page cache`);
      await runStartup(browser, worldPages, "1", "prime", timeout);

      console.log(`[heightfield-bench] world=${worldPages}: warm cache run`);
      const warm = await runStartup(browser, worldPages, "1", "warm", timeout);
      runs.push(warm);
    }
  } finally {
    await browser.close();
  }

  const measured = worlds.map((worldPages) => {
    const cold = runs.find((run) => run.worldPages === worldPages && run.label === "cold");
    const warm = runs.find((run) => run.worldPages === worldPages && run.label === "warm");
    if (!cold || !warm) throw new Error(`missing benchmark result for world ${worldPages}`);
    return summaryRow(cold, warm);
  });
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    browserRecipe: recipe,
    worlds,
    measured,
    runs,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`[heightfield-bench] wrote ${out}`);
  console.table(measured);
}

main().catch((error) => {
  console.error("[heightfield-bench] FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
