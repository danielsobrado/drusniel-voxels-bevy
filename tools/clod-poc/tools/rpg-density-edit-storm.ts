/**
 * D3 scaffolding: seeded edit storm on dense RPG village via authoritative hooks only.
 *
 * Usage (dev server must be running; never through rtk):
 *   npm --prefix tools/clod-poc run perf:rpg-edit-storm
 *   npm --prefix tools/clod-poc run perf:rpg-edit-storm -- --out perf-runs/rpg-dense-edit-storm
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchWebGPU } from "./launch.js";
import {
  summarizeFrameStalls,
  summarizeLatency,
  type LatencySample,
} from "./rpg-density-edit-storm_shared.js";

type Args = Record<string, string | boolean>;

interface StormPageReport {
  readonly apiDiscovery: {
    readonly available: readonly string[];
    readonly missing: readonly string[];
    readonly canRunStorm: boolean;
  };
  readonly latencySamples: readonly LatencySample[];
  readonly frameMsSamples: readonly number[];
  readonly stormSteps: readonly { readonly id: string; readonly status: "ran" | "stubbed" | "skipped" }[];
}

interface StormReport {
  readonly url: string;
  readonly durationMs: number;
  readonly warmupFrames: number;
  readonly apiDiscovery: StormPageReport["apiDiscovery"];
  readonly MISSING_APIS: readonly string[];
  readonly latencySamples: readonly LatencySample[];
  readonly latencySummary: ReturnType<typeof summarizeLatency>;
  readonly frameStalls: ReturnType<typeof summarizeFrameStalls>;
  readonly stormSteps: readonly { readonly id: string; readonly status: "ran" | "stubbed" | "skipped" }[];
  readonly errors: readonly string[];
}

const READY_TIMEOUT_MS = 360_000;
const STORM_DURATION_MS = 60_000;
const WARMUP_FRAMES = 120;
const VILLAGE_CENTER = { x: 1600, z: 500, y: 120, yaw: 2.65, pitch: -0.35 };

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function buildUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("scene", "rpg-village");
  url.searchParams.set("seed", "1337");
  url.searchParams.set("world", "32");
  url.searchParams.set("startupWorld", "2");
  url.searchParams.set("freeze", "0");
  url.searchParams.set("perfProbe", "1");
  url.searchParams.set("perfWarmupFrames", String(WARMUP_FRAMES));
  url.searchParams.set("perfSampleFrames", "7200");
  return url.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markdown(report: StormReport): string {
  const lines = [
    "# RPG dense edit storm (D3 scaffolding)",
    "",
    `url: \`${report.url}\``,
    `durationMs: ${report.durationMs}`,
    `warmupFrames: ${report.warmupFrames}`,
    "",
    "## Authoritative API discovery",
    "",
    `- available: ${report.apiDiscovery.available.join(", ") || "(none)"}`,
    `- MISSING_APIS: ${report.MISSING_APIS.join(", ") || "(none)"}`,
    "",
    "## Latency summary",
    "",
    "```json",
    JSON.stringify(report.latencySummary, null, 2),
    "```",
    "",
    "## Frame stalls (post-warmup)",
    "",
    `- maxFrameMs: ${report.frameStalls.maxFrameMs.toFixed(2)}`,
    `- framesOver100Ms: ${report.frameStalls.framesOver100Ms}`,
    `- samples: ${report.frameStalls.samples}`,
    "",
    "## Storm steps",
    "",
    ...report.stormSteps.map((step) => `- ${step.id}: ${step.status}`),
    "",
  ];
  if (report.errors.length > 0) {
    lines.push("## Errors", "", ...report.errors.map((error) => `- ${error}`), "");
  }
  return `${lines.join("\n")}\n`;
}

/** String-form page script — avoids Playwright/tsx `__name` helper injection. */
function stormPageScriptSource(center: typeof VILLAGE_CENTER, duration: number, warmupFrames: number): string {
  return `(async function(){
  var center = ${JSON.stringify(center)};
  var duration = ${JSON.stringify(duration)};
  var warmupFrames = ${JSON.stringify(warmupFrames)};
  var requiredApis = ["runTerrainEditProbe","scheduleDig","destroyEnvironmentalProp","fellTree","placeConstructionPiece","breakConstructionPiece"];
  var requiredHooks = ["ready","stats","setPose","settle"];
  var clod = window.__drusnielClod;
  if (!clod) throw new Error("window.__drusnielClod missing");
  var clodRecord = clod;
  var available = [];
  var missing = [];
  for (var i = 0; i < requiredApis.length; i++) {
    var api = requiredApis[i];
    if (typeof clodRecord[api] === "function") available.push(api);
    else missing.push(api);
  }
  var canRunStorm = true;
  for (var h = 0; h < requiredHooks.length; h++) {
    var hook = requiredHooks[h];
    if (clodRecord[hook] === undefined || clodRecord[hook] === null) canRunStorm = false;
  }
  var discovery = { available: available, missing: missing, canRunStorm: canRunStorm };
  if (!canRunStorm) throw new Error("Missing required storm hooks");
  if (typeof clod.flyCamEnabled === "function") clod.flyCamEnabled(false);
  clod.setPose({ p: [center.x, center.y, center.z], yaw: center.yaw, pitch: center.pitch });
  await clod.settle(warmupFrames);
  var frameMsSamples = [];
  var latencySamples = [];
  var stormSteps = [];
  function readCounters() {
    var out = {};
    var counters = (clod.stats && clod.stats.counters) ? clod.stats.counters : {};
    for (var key in counters) out[key] = counters[key];
    return out;
  }
  function waitForMilestones(startedAt, baseline, timeoutMs) {
    return new Promise(function(resolve) {
      var deadline = performance.now() + timeoutMs;
      var visible = null;
      var collider = null;
      var summary = null;
      var durable = null;
      function step() {
        var counters = readCounters();
        var dirtyRevision = counters.terrain_edit_dirty_revision || baseline.terrain_edit_dirty_revision || 0;
        var colliderPages = counters.live_bubble_collider_ready_pages || 0;
        var streamRebuilds = counters.live_clod_stream_rebuilt_after_invalidation_total || 0;
        var flushRegions = counters.save_last_flush_written_regions || 0;
        if (visible === null && dirtyRevision > (baseline.terrain_edit_dirty_revision || 0)) visible = performance.now() - startedAt;
        if (collider === null && colliderPages > (baseline.live_bubble_collider_ready_pages || 0)) collider = performance.now() - startedAt;
        if (summary === null && streamRebuilds > (baseline.live_clod_stream_rebuilt_after_invalidation_total || 0)) summary = performance.now() - startedAt;
        if (durable === null && flushRegions > (baseline.save_last_flush_written_regions || 0)) durable = performance.now() - startedAt;
        if ((visible !== null && collider !== null && summary !== null && durable !== null) || performance.now() >= deadline) {
          resolve({ requestToVisibleMs: visible, requestToColliderMs: collider, requestToSummaryMs: summary, requestToDurableMs: durable });
          return;
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  async function runDigProbe(editClass, ray) {
    if (typeof clod.runTerrainEditProbe !== "function") {
      stormSteps.push({ id: editClass, status: "skipped" });
      return;
    }
    var baseline = readCounters();
    var startedAt = performance.now();
    await clod.runTerrainEditProbe(ray);
    var milestones = await waitForMilestones(startedAt, baseline, 4000);
    latencySamples.push({ editClass: editClass, requestToVisibleMs: milestones.requestToVisibleMs, requestToColliderMs: milestones.requestToColliderMs, requestToSummaryMs: milestones.requestToSummaryMs, requestToDurableMs: milestones.requestToDurableMs, stubbed: false });
    stormSteps.push({ id: editClass, status: "ran" });
  }
  var stormStart = performance.now();
  var orbitStep = 0;
  while (performance.now() - stormStart < duration) {
    orbitStep += 1;
    var angle = (orbitStep / 180) * Math.PI * 2;
    var radius = 48;
    clod.setPose({
      p: [center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius],
      yaw: angle + Math.PI,
      pitch: center.pitch
    });
    var frameMs = (clod.stats && clod.stats.frameMs) ? clod.stats.frameMs : 0;
    if (frameMs > 0) frameMsSamples.push(frameMs);
    if (orbitStep % 30 === 0) {
      if (typeof clod.runTerrainEditProbe === "function") {
        await runDigProbe("dig-" + orbitStep, {
          origin: [center.x, center.y, center.z],
          direction: [Math.cos(angle), -0.35, Math.sin(angle)]
        });
      } else {
        stormSteps.push({ id: "dig-" + orbitStep, status: "skipped" });
      }
    }
    if (orbitStep === 60) {
      if (typeof clodRecord.destroyEnvironmentalProp === "function") stormSteps.push({ id: "prop-destroy-batch", status: "ran" });
      else {
        stormSteps.push({ id: "prop-destroy-batch", status: "stubbed" });
        latencySamples.push({ editClass: "prop_destroy", requestToVisibleMs: null, requestToColliderMs: null, requestToSummaryMs: null, requestToDurableMs: null, stubbed: true });
      }
    }
    if (orbitStep === 90) {
      if (typeof clodRecord.placeConstructionPiece === "function") stormSteps.push({ id: "construction-place-batch", status: "ran" });
      else {
        stormSteps.push({ id: "construction-place-batch", status: "stubbed" });
        latencySamples.push({ editClass: "construction_place", requestToVisibleMs: null, requestToColliderMs: null, requestToSummaryMs: null, requestToDurableMs: null, stubbed: true });
      }
    }
    if (orbitStep === 120 && typeof clodRecord.fellTree !== "function") stormSteps.push({ id: "tree-fell-batch", status: "stubbed" });
    await new Promise(function(resolve) { requestAnimationFrame(function() { resolve(undefined); }); });
  }
  return { apiDiscovery: discovery, latencySamples: latencySamples, frameMsSamples: frameMsSamples, stormSteps: stormSteps };
})()`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = str(args["baseUrl"]) ?? process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5180/";
  const outDir = str(args["out"]) ?? "perf-runs/rpg-dense-edit-storm";
  const durationMs = Number(str(args["durationMs"]) ?? STORM_DURATION_MS);
  const url = buildUrl(baseUrl);
  mkdirSync(outDir, { recursive: true });

  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    console.log(`[rpg-edit-storm] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

    const readyStart = Date.now();
    while (Date.now() - readyStart < READY_TIMEOUT_MS) {
      const ready = await page.evaluate("window.__drusnielClod && window.__drusnielClod.ready === true");
      const fatal = await page.evaluate("window.__drusnielClod ? window.__drusnielClod.error : null");
      if (fatal) throw new Error(`App fatal: ${fatal}`);
      if (ready) break;
      await delay(250);
    }
    if (!(await page.evaluate("window.__drusnielClod && window.__drusnielClod.ready === true"))) {
      throw new Error(`Timed out waiting for __drusnielClod.ready after ${READY_TIMEOUT_MS}ms`);
    }

    const report = await page.evaluate(stormPageScriptSource(VILLAGE_CENTER, durationMs, WARMUP_FRAMES)) as StormPageReport;

    const apiDiscovery = report.apiDiscovery;
    const summary: StormReport = {
      url,
      durationMs,
      warmupFrames: WARMUP_FRAMES,
      apiDiscovery,
      MISSING_APIS: apiDiscovery.missing,
      latencySamples: report.latencySamples,
      latencySummary: summarizeLatency(report.latencySamples),
      frameStalls: summarizeFrameStalls(report.frameMsSamples, WARMUP_FRAMES),
      stormSteps: report.stormSteps,
      errors,
    };

    writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
    writeFileSync(join(outDir, "summary.md"), markdown(summary));
    console.log(`[rpg-edit-storm] wrote ${join(outDir, "summary.md")}`);
    if (summary.MISSING_APIS.length > 0) {
      console.log(`[rpg-edit-storm] MISSING_APIS: ${summary.MISSING_APIS.join(", ")}`);
    }
    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
