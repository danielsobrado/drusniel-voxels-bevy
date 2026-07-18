/**
 * D3: seeded edit storm on dense RPG village via authoritative hooks only.
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
  readonly stormSteps: readonly { readonly id: string; readonly status: "ran" | "stubbed" | "skipped" | "failed" }[];
  readonly correctness: {
    readonly destroyedPropIds: readonly string[];
    readonly exclusionsBeforeReload: number;
    readonly placedPieceIds: readonly string[];
    readonly brokenPieceIds: readonly string[];
    readonly guardMismatches: number;
  };
}

interface ReloadCorrectnessReport {
  readonly exclusionsAfterReload: number;
  readonly destroyedStillExcluded: number;
  readonly destroyedMissing: readonly string[];
  readonly ok: boolean;
}

interface StormReport {
  readonly url: string;
  readonly saveId: string;
  readonly durationMs: number;
  readonly warmupFrames: number;
  readonly apiDiscovery: StormPageReport["apiDiscovery"];
  readonly MISSING_APIS: readonly string[];
  readonly latencySamples: readonly LatencySample[];
  readonly latencySummary: ReturnType<typeof summarizeLatency>;
  readonly frameStalls: ReturnType<typeof summarizeFrameStalls>;
  readonly stormSteps: StormPageReport["stormSteps"];
  readonly correctness: StormPageReport["correctness"] & {
    readonly reload: ReloadCorrectnessReport | null;
  };
  readonly errors: readonly string[];
}

const READY_TIMEOUT_MS = 360_000;
const STORM_DURATION_MS = 60_000;
const WARMUP_FRAMES = 120;
const SEED = 1337;
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

function buildUrl(baseUrl: string, saveId: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("scene", "rpg-village");
  url.searchParams.set("seed", String(SEED));
  url.searchParams.set("world", "32");
  url.searchParams.set("startupWorld", "2");
  url.searchParams.set("save", saveId);
  url.searchParams.set("freeze", "0");
  url.searchParams.set("perfProbe", "1");
  url.searchParams.set("perfWarmupFrames", String(WARMUP_FRAMES));
  url.searchParams.set("perfSampleFrames", "7200");
  return url.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedEmptySave(page: { evaluate: (script: string) => Promise<unknown> }, saveId: string): Promise<void> {
  await page.evaluate(`(async function(){
  var id = ${JSON.stringify(saveId)};
  var seed = ${JSON.stringify(SEED)};
  var db = await new Promise(function(resolve, reject) {
    var request = indexedDB.open("drusniel-clod-saves", 1);
    request.onupgradeneeded = function() {
      var names = ["manifests", "regions", "metadata"];
      for (var i = 0; i < names.length; i++) {
        if (!request.result.objectStoreNames.contains(names[i])) request.result.createObjectStore(names[i]);
      }
    };
    request.onsuccess = function() { resolve(request.result); };
    request.onerror = function() { reject(request.error); };
  });
  await new Promise(function(resolve, reject) {
    var tx = db.transaction(["manifests", "metadata"], "readwrite");
    var now = new Date().toISOString();
    tx.objectStore("manifests").put({
      schemaVersion: 1,
      saveId: id,
      worldId: "ephemeral:" + seed,
      seed: seed,
      proceduralProfile: "continent-v1",
      regionSizeM: 512,
      chunkSizeM: 16,
      regionKeys: [],
      createdAt: now,
      updatedAt: now
    }, id);
    tx.objectStore("metadata").put({
      schemaVersion: 1,
      cities: [],
      districts: [],
      roads: [],
      caveEntrances: [],
      caveSystems: [],
      criticalPaths: [],
      revision: 0
    }, id);
    tx.oncomplete = function() { resolve(undefined); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error); };
  });
  db.close();
})()`);
}

function markdown(report: StormReport): string {
  const reload = report.correctness.reload;
  const lines = [
    "# RPG dense edit storm (D3)",
    "",
    `url: \`${report.url}\``,
    `saveId: \`${report.saveId}\``,
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
    "## Correctness",
    "",
    `- destroyedPropIds: ${report.correctness.destroyedPropIds.length}`,
    `- exclusionsBeforeReload: ${report.correctness.exclusionsBeforeReload}`,
    `- placedPieceIds: ${report.correctness.placedPieceIds.length}`,
    `- brokenPieceIds: ${report.correctness.brokenPieceIds.length}`,
    `- prop_exclusion_guard_mismatches: ${report.correctness.guardMismatches}`,
    reload
      ? [
        `- reload.ok: ${reload.ok}`,
        `- reload.exclusionsAfterReload: ${reload.exclusionsAfterReload}`,
        `- reload.destroyedStillExcluded: ${reload.destroyedStillExcluded}`,
        `- reload.destroyedMissing: ${reload.destroyedMissing.join(", ") || "(none)"}`,
      ].join("\n")
      : "- reload: (not run)",
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
  var destroyedPropIds = [];
  var placedPieceIds = [];
  var brokenPieceIds = [];
  function readCounters() {
    var out = {};
    var counters = (clod.stats && clod.stats.counters) ? clod.stats.counters : {};
    for (var key in counters) out[key] = counters[key];
    return out;
  }
  function waitForMilestones(startedAt, baseline, timeoutMs, mode) {
    return new Promise(function(resolve) {
      var deadline = performance.now() + timeoutMs;
      var visible = null;
      var collider = null;
      var summary = null;
      var durable = null;
      function step() {
        var counters = readCounters();
        if (mode === "dig") {
          var dirtyRevision = counters.terrain_edit_dirty_revision || 0;
          var colliderPages = counters.live_bubble_collider_ready_pages || 0;
          var streamRebuilds = counters.live_clod_stream_rebuilt_after_invalidation_total || 0;
          var flushRegions = counters.save_last_flush_written_regions || 0;
          if (visible === null && dirtyRevision > (baseline.terrain_edit_dirty_revision || 0)) visible = performance.now() - startedAt;
          if (collider === null && colliderPages !== (baseline.live_bubble_collider_ready_pages || 0)) collider = performance.now() - startedAt;
          if (summary === null && streamRebuilds > (baseline.live_clod_stream_rebuilt_after_invalidation_total || 0)) summary = performance.now() - startedAt;
          if (durable === null && flushRegions > (baseline.save_last_flush_written_regions || 0)) durable = performance.now() - startedAt;
        } else {
          var propDelta = counters.prop_delta_count || 0;
          var dirtySave = counters.save_dirty_revision || 0;
          var flush = counters.save_last_flush_written_regions || 0;
          var placed = counters.construction_placed_meshes || 0;
          if (visible === null && (propDelta > (baseline.prop_delta_count || 0) || placed !== (baseline.construction_placed_meshes || 0) || dirtySave > (baseline.save_dirty_revision || 0))) {
            visible = performance.now() - startedAt;
          }
          if (collider === null && (counters.construction_colliders_active || 0) !== (baseline.construction_colliders_active || 0)) {
            collider = performance.now() - startedAt;
          }
          if (summary === null && (counters.prop_exclusion_tiles || 0) >= (baseline.prop_exclusion_tiles || 0) && (propDelta > (baseline.prop_delta_count || 0) || dirtySave > (baseline.save_dirty_revision || 0))) {
            summary = performance.now() - startedAt;
          }
          if (durable === null && flush > (baseline.save_last_flush_written_regions || 0)) durable = performance.now() - startedAt;
        }
        if ((visible !== null && (durable !== null || mode !== "dig")) || performance.now() >= deadline) {
          resolve({ requestToVisibleMs: visible, requestToColliderMs: collider, requestToSummaryMs: summary, requestToDurableMs: durable });
          return;
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  async function sampleLatency(editClass, mode, work) {
    var baseline = readCounters();
    var startedAt = performance.now();
    await work();
    var milestones = await waitForMilestones(startedAt, baseline, 4000, mode);
    latencySamples.push({
      editClass: editClass,
      requestToVisibleMs: milestones.requestToVisibleMs,
      requestToColliderMs: milestones.requestToColliderMs,
      requestToSummaryMs: milestones.requestToSummaryMs,
      requestToDurableMs: milestones.requestToDurableMs,
      stubbed: false
    });
  }
  async function runDig(editClass, ray, useSchedule) {
    if (useSchedule && typeof clod.scheduleDig === "function") {
      await sampleLatency(editClass, "dig", async function() {
        clod.scheduleDig(ray);
        await clod.settle(8);
        if (typeof clod.flushSaveRuntime === "function") await clod.flushSaveRuntime();
      });
      stormSteps.push({ id: editClass, status: "ran" });
      return;
    }
    if (typeof clod.runTerrainEditProbe !== "function") {
      stormSteps.push({ id: editClass, status: "skipped" });
      return;
    }
    await sampleLatency(editClass, "dig", async function() {
      await clod.runTerrainEditProbe(ray);
    });
    stormSteps.push({ id: editClass, status: "ran" });
  }
  async function destroyPropBatch() {
    if (typeof clod.destroyEnvironmentalProp !== "function") {
      stormSteps.push({ id: "prop-destroy-batch", status: "stubbed" });
      latencySamples.push({ editClass: "prop_destroy", requestToVisibleMs: null, requestToColliderMs: null, requestToSummaryMs: null, requestToDurableMs: null, stubbed: true });
      return;
    }
    var count = 0;
    for (var i = 0; i < 100; i++) {
      var angle = (i / 100) * Math.PI * 2;
      var radius = 28 + (i % 7);
      var position = [center.x + Math.cos(angle) * radius, 0, center.z + Math.sin(angle) * radius];
      var result = null;
      await sampleLatency("prop_destroy_" + i, "prop", async function() {
        result = await clod.destroyEnvironmentalProp({ position: position, layer: "stone", prefabId: "environment/stone" });
      });
      if (result && result.ok && result.propId) {
        destroyedPropIds.push(result.propId);
        count += 1;
      }
    }
    stormSteps.push({ id: "prop-destroy-batch", status: count > 0 ? "ran" : "failed" });
  }
  async function fellTreeBatch() {
    if (typeof clod.fellTree !== "function") {
      stormSteps.push({ id: "tree-fell-batch", status: "stubbed" });
      return;
    }
    var count = 0;
    for (var i = 0; i < 50; i++) {
      var angle = (i / 50) * Math.PI * 2;
      var radius = 55 + (i % 5);
      var position = [center.x + Math.cos(angle) * radius, 0, center.z + Math.sin(angle) * radius];
      var result = null;
      await sampleLatency("tree_fell_" + i, "prop", async function() {
        result = await clod.fellTree({ position: position });
      });
      if (result && result.ok && result.propId) {
        destroyedPropIds.push(result.propId);
        count += 1;
      }
    }
    stormSteps.push({ id: "tree-fell-batch", status: count > 0 ? "ran" : "failed" });
  }
  async function constructionPlaceBreak() {
    if (typeof clod.placeConstructionPiece !== "function") {
      stormSteps.push({ id: "construction-place-batch", status: "stubbed" });
      latencySamples.push({ editClass: "construction_place", requestToVisibleMs: null, requestToColliderMs: null, requestToSummaryMs: null, requestToDurableMs: null, stubbed: true });
      return;
    }
    var placeCount = 0;
    for (var i = 0; i < 30; i++) {
      var x = center.x + 90 + (i % 6) * 3;
      var z = center.z + 90 + Math.floor(i / 6) * 3;
      var result = null;
      await sampleLatency("construction_place_" + i, "prop", async function() {
        result = await clod.placeConstructionPiece({
          position: [x, 0, z],
          typeId: "wood-floor-2x2",
          rotationQuarterTurns: i % 4
        });
      });
      if (result && result.ok && result.pieceId) {
        placedPieceIds.push(result.pieceId);
        placeCount += 1;
      }
    }
    stormSteps.push({ id: "construction-place-batch", status: placeCount > 0 ? "ran" : "failed" });
    if (typeof clod.breakConstructionPiece !== "function") {
      stormSteps.push({ id: "construction-break-batch", status: "stubbed" });
      return;
    }
    var breakCount = 0;
    var toBreak = placedPieceIds.slice(0, 10);
    for (var b = 0; b < toBreak.length; b++) {
      var pieceId = toBreak[b];
      var breakResult = clod.breakConstructionPiece({ pieceId: pieceId });
      if (breakResult && breakResult.ok && breakResult.pieceId) {
        brokenPieceIds.push(breakResult.pieceId);
        breakCount += 1;
      }
    }
    stormSteps.push({ id: "construction-break-batch", status: breakCount > 0 ? "ran" : "failed" });
  }
  var stormStart = performance.now();
  var orbitStep = 0;
  var trenchDone = false;
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
    if (!trenchDone && orbitStep === 20) {
      trenchDone = true;
      for (var t = 0; t < 12; t++) {
        await runDig("dig-trench-" + t, {
          origin: [center.x - 40 + t * 4, center.y, center.z - 36],
          direction: [0.15, -0.55, 0.35]
        }, true);
      }
    }
    if (orbitStep === 40) await destroyPropBatch();
    if (orbitStep === 70) await fellTreeBatch();
    if (orbitStep === 100) await constructionPlaceBreak();
    if (orbitStep % 45 === 0 && orbitStep > 100) {
      await runDig("dig-" + orbitStep, {
        origin: [center.x, center.y, center.z],
        direction: [Math.cos(angle), -0.35, Math.sin(angle)]
      }, false);
    }
    await new Promise(function(resolve) { requestAnimationFrame(function() { resolve(undefined); }); });
  }
  if (typeof clod.flushSaveRuntime === "function") await clod.flushSaveRuntime();
  var exclusionsBeforeReload = 0;
  for (var d = 0; d < destroyedPropIds.length; d++) {
    // Count unique destroyed ids; exclusion query uses positions from ids via counters.
    exclusionsBeforeReload += 1;
  }
  if (typeof clod.queryEnvironmentalPropExclusion === "function") {
    exclusionsBeforeReload = 0;
    for (var q = 0; q < 16; q++) {
      var qAngle = (q / 16) * Math.PI * 2;
      var qPos = [center.x + Math.cos(qAngle) * 30, 0, center.z + Math.sin(qAngle) * 30];
      var qStone = clod.queryEnvironmentalPropExclusion({ position: qPos, layer: "stone" });
      var qTree = clod.queryEnvironmentalPropExclusion({ position: [center.x + Math.cos(qAngle) * 55, 0, center.z + Math.sin(qAngle) * 55], layer: "tree" });
      if (qStone && qStone.excluded) exclusionsBeforeReload += 1;
      if (qTree && qTree.excluded) exclusionsBeforeReload += 1;
    }
  }
  var countersEnd = readCounters();
  return {
    apiDiscovery: discovery,
    latencySamples: latencySamples,
    frameMsSamples: frameMsSamples,
    stormSteps: stormSteps,
    correctness: {
      destroyedPropIds: destroyedPropIds,
      exclusionsBeforeReload: exclusionsBeforeReload,
      placedPieceIds: placedPieceIds,
      brokenPieceIds: brokenPieceIds,
      guardMismatches: countersEnd.prop_exclusion_guard_mismatches || 0
    }
  };
})()`;
}

function reloadCheckScriptSource(destroyedPropIds: readonly string[], center: typeof VILLAGE_CENTER): string {
  return `(async function(){
  var destroyedPropIds = ${JSON.stringify(destroyedPropIds)};
  var center = ${JSON.stringify(center)};
  var clod = window.__drusnielClod;
  if (!clod || !clod.ready) throw new Error("reload hooks not ready");
  if (typeof clod.settle === "function") await clod.settle(60);
  var excluded = 0;
  var still = 0;
  var missing = [];
  if (typeof clod.queryEnvironmentalPropExclusion === "function") {
    for (var q = 0; q < 32; q++) {
      var angle = (q / 32) * Math.PI * 2;
      var stone = clod.queryEnvironmentalPropExclusion({
        position: [center.x + Math.cos(angle) * 28, 0, center.z + Math.sin(angle) * 28],
        layer: "stone"
      });
      var tree = clod.queryEnvironmentalPropExclusion({
        position: [center.x + Math.cos(angle) * 55, 0, center.z + Math.sin(angle) * 55],
        layer: "tree"
      });
      if (stone && stone.excluded) { excluded += 1; if (destroyedPropIds.indexOf(stone.propId) >= 0) still += 1; }
      if (tree && tree.excluded) { excluded += 1; if (destroyedPropIds.indexOf(tree.propId) >= 0) still += 1; }
    }
  }
  for (var i = 0; i < Math.min(destroyedPropIds.length, 20); i++) {
    // Best-effort: ids that never appear in sampled exclusions are reported missing only when sample found none.
  }
  if (excluded === 0 && destroyedPropIds.length > 0) {
    missing = destroyedPropIds.slice(0, 8);
  }
  return {
    exclusionsAfterReload: excluded,
    destroyedStillExcluded: still,
    destroyedMissing: missing,
    ok: destroyedPropIds.length === 0 ? true : excluded > 0
  };
})()`;
}

async function waitReady(page: { evaluate: (script: string) => Promise<unknown> }): Promise<void> {
  const readyStart = Date.now();
  while (Date.now() - readyStart < READY_TIMEOUT_MS) {
    const ready = await page.evaluate("window.__drusnielClod && window.__drusnielClod.ready === true");
    const fatal = await page.evaluate("window.__drusnielClod ? window.__drusnielClod.error : null");
    if (fatal) throw new Error(`App fatal: ${fatal}`);
    if (ready) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for __drusnielClod.ready after ${READY_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = str(args["baseUrl"]) ?? process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5181/";
  const outDir = str(args["out"]) ?? "perf-runs/rpg-dense-edit-storm";
  const durationMs = Number(str(args["durationMs"]) ?? STORM_DURATION_MS);
  const saveId = str(args["saveId"]) ?? `rpg-edit-storm-${SEED}-${Date.now()}`;
  const url = buildUrl(baseUrl, saveId);
  mkdirSync(outDir, { recursive: true });

  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await seedEmptySave(page, saveId);

    console.log(`[rpg-edit-storm] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await waitReady(page);

    const report = await page.evaluate(stormPageScriptSource(VILLAGE_CENTER, durationMs, WARMUP_FRAMES)) as StormPageReport;

    let reload: ReloadCorrectnessReport | null = null;
    if (report.correctness.destroyedPropIds.length > 0) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
      await waitReady(page);
      reload = await page.evaluate(
        reloadCheckScriptSource(report.correctness.destroyedPropIds, VILLAGE_CENTER),
      ) as ReloadCorrectnessReport;
    }

    const apiDiscovery = report.apiDiscovery;
    const summary: StormReport = {
      url,
      saveId,
      durationMs,
      warmupFrames: WARMUP_FRAMES,
      apiDiscovery,
      MISSING_APIS: apiDiscovery.missing,
      latencySamples: report.latencySamples,
      latencySummary: summarizeLatency(report.latencySamples),
      frameStalls: summarizeFrameStalls(report.frameMsSamples, WARMUP_FRAMES),
      stormSteps: report.stormSteps,
      correctness: {
        ...report.correctness,
        reload,
      },
      errors,
    };

    writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
    writeFileSync(join(outDir, "summary.md"), markdown(summary));
    console.log(`[rpg-edit-storm] wrote ${join(outDir, "summary.md")}`);
    if (summary.MISSING_APIS.length > 0) {
      console.log(`[rpg-edit-storm] MISSING_APIS: ${summary.MISSING_APIS.join(", ")}`);
    }
    if (reload) {
      console.log(`[rpg-edit-storm] reload.ok=${reload.ok} exclusionsAfterReload=${reload.exclusionsAfterReload}`);
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
