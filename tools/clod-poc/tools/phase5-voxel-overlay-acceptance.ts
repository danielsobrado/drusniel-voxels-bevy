import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clodUrl, launchWebGPU } from "./launch.js";

const SAVE_ID = "phase5-voxel-overlay-acceptance";
const ROUTE_X = 576;
const ROUTE_Z = 320;
const OBSERVE_X = ROUTE_X;
const OBSERVE_Z = ROUTE_Z;
const WORLD_PAGES = 8;
const OUT = fileURLToPath(new URL("../acceptance-runs/phase5-voxel-overlay/report.json", import.meta.url));

async function withTimeout<T>(label: string, operation: Promise<T>, timeoutMs = 180_000): Promise<T> {
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

async function waitForReady(page: import("playwright").Page): Promise<void> {
  await withTimeout("app ready", page.waitForFunction(
    () => window.__drusnielClod && (window.__drusnielClod.ready || window.__drusnielClod.error !== null),
    undefined,
    { timeout: 180_000, polling: 250 },
  ), 180_000);
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(error);
}

async function seedEmptySave(page: import("playwright").Page): Promise<void> {
  await page.evaluate(async ({ saveId }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("drusniel-clod-saves");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("save database deletion blocked"));
    });
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
        saveId,
        worldId: "phase5-acceptance-world",
        seed: 1,
        proceduralProfile: "infinite-islands-v1",
        regionSizeM: 512,
        chunkSizeM: 16,
        regionKeys: [],
        createdAt: now,
        updatedAt: now,
      }, saveId);
      tx.objectStore("metadata").put({
        schemaVersion: 1,
        cities: [],
        districts: [],
        roads: [],
        caveEntrances: [],
        caveSystems: [],
        criticalPaths: [],
        revision: 0,
      }, saveId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { saveId: SAVE_ID });
}

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  let completed = false;
  try {
    browser.on("disconnected", () => {
      if (!completed) console.error("[phase5] browser disconnected before completion");
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("close", () => {
      if (!completed) console.error("[phase5] page closed before completion");
    });
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        console.log(`[page:${message.type()}] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => console.error(`[pageerror] ${error.message}`));

    await page.goto(clodUrl({ scene: "cave-test", seed: 1, extra: { world: String(WORLD_PAGES), liveClodRootRadius: "256" } }), { waitUntil: "domcontentloaded" });
    await seedEmptySave(page);
    console.log("[phase5] seeded acceptance save");

    const url = clodUrl({
      scene: "cave-test",
      seed: 1,
      extra: { world: String(WORLD_PAGES), save: SAVE_ID, freeze: "1", hud: "1", liveClodRootRadius: "256" },
    });
    console.log(`[phase5] loading ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    console.log("[phase5] saved scene navigation complete");
    await waitForReady(page);
    console.log("[phase5] saved scene ready");
    await withTimeout("streaming route settle", page.evaluate(async ({ x, z }) => {
      const hooks = window.__drusnielClod;
      hooks?.setPose?.({ p: [x, 260, z], yaw: 0, pitch: -Math.PI / 2, fov: 60 });
      await hooks?.settle?.(240);
    }, { x: ROUTE_X, z: ROUTE_Z }));
    await withTimeout("streaming edit authority", page.waitForFunction(() => {
      const counters = window.__drusnielClod?.stats?.counters ?? {};
      return (counters["live_clod_stream_required_pages"] ?? 0) > 0
        && counters["live_clod_stream_out_of_world_edits_supported"] === 1;
    }, undefined, { polling: 100, timeout: 60_000 }), 60_000);
    console.log("[phase5] out-of-startup-world route settled");

    const target = { key: "L1:4,2", x: ROUTE_X, z: ROUTE_Z };

    const edit = await withTimeout("terrain edit probe", page.evaluate(async ({ x, z }) => {
      const hooks = window.__drusnielClod;
      if (!hooks?.runTerrainEditProbe) throw new Error("terrain edit probe hook is unavailable");
      return hooks.runTerrainEditProbe({ origin: [x, 260, z], direction: [0, -1, 0] });
    }, target), 240_000);
    console.log(`[phase5] edit committed ${JSON.stringify(edit)}`);
    if (edit.editRevision < 1 || edit.voxelDeltaCount < 1 || edit.dirtyRevision < 1) {
      throw new Error(`terrain edit did not commit: ${JSON.stringify(edit)}`);
    }
    if (edit.streamInvalidations < 1) {
      throw new Error(`streamed root was not invalidated: ${JSON.stringify(edit)}`);
    }

    const streamRebuild = await withTimeout("streamed root rebuild", page.evaluate(async ({ x, z, previous }) => {
      const hooks = window.__drusnielClod;
      hooks?.setPose?.({ p: [x, 260, z], yaw: 0, pitch: -Math.PI / 2, fov: 60 });
      for (let guard = 0; guard < 7200; guard++) {
        const rebuilt = hooks?.stats?.counters["live_clod_stream_rebuilt_after_invalidation_total"] ?? 0;
        if (rebuilt > previous) break;
        await hooks?.settle?.(1);
      }
      const counters = hooks?.stats?.counters ?? {};
      return {
        rebuilt: counters["live_clod_stream_rebuilt_after_invalidation_total"] ?? 0,
        requestedL0: counters["live_clod_stream_requested_l0_pages"] ?? 0,
        requestedL1: counters["live_clod_stream_requested_l1_pages"] ?? 0,
        appliedL0: counters["live_clod_stream_applied_l0_pages"] ?? 0,
        appliedL1: counters["live_clod_stream_applied_l1_pages"] ?? 0,
        failures: counters["live_clod_stream_worker_build_failures"] ?? 0,
        pending: counters["live_clod_stream_pending_pages"] ?? 0,
        readyKeys: hooks?.getStreamingRootReadyPageKeys?.() ?? [],
      };
    }, { x: OBSERVE_X, z: OBSERVE_Z, previous: edit.streamRebuilds }), 240_000);
    if (streamRebuild.rebuilt <= edit.streamRebuilds) {
      throw new Error(`invalidated streamed root did not rebuild after the edit: ${JSON.stringify(streamRebuild)}`);
    }
    console.log(`[phase5] streamed root rebuilt (${streamRebuild.rebuilt})`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForReady(page);
    console.log("[phase5] reloaded saved scene");
    const reloaded = await page.evaluate(() => ({
      saveLoaded: window.__drusnielClod?.stats?.counters["save_loaded"] ?? 0,
      voxelDeltaCount: window.__drusnielClod?.stats?.counters["save_voxel_delta_count"] ?? 0,
      saveError: window.__drusnielClod?.stats?.counters["save_last_error"] ?? 0,
    }));
    if (reloaded.saveLoaded !== 1 || reloaded.voxelDeltaCount < 1 || reloaded.saveError !== 0) {
      throw new Error(`saved edit did not survive reload: ${JSON.stringify(reloaded)}`);
    }

    const gameplayUrl = clodUrl({
      scene: "cave-test",
      seed: 1,
      extra: {
        world: "4",
        x: "720",
        z: "70",
        yaw: String(Math.PI),
        hud: "1",
        liveBubble: "1",
        liveBubbleRadius: "200",
        liveClodRootRadius: "256",
        liveBubbleColliderRadius: "128",
      },
    });
    await page.goto(gameplayUrl, { waitUntil: "domcontentloaded" });
    await waitForReady(page);
    await withTimeout("cave player spawn", page.waitForFunction(
      () => Math.abs((window.__drusnielClod?.getPose?.().p[0] ?? 0) - 720) < 1,
      undefined,
      { polling: 100, timeout: 90_000 },
    ), 90_000);
    await page.evaluate(async () => window.__drusnielClod?.settle?.(360));
    const gameplayBefore = await page.evaluate(() => ({
      pose: window.__drusnielClod?.getPose?.() ?? null,
      colliders: window.__drusnielClod?.stats?.counters["live_bubble_streamed_collider_pages"] ?? 0,
    }));
    await page.keyboard.down("w");
    await page.waitForTimeout(4_000);
    await page.keyboard.up("w");
    await page.evaluate(async () => window.__drusnielClod?.settle?.(60));
    const gameplayAfter = await page.evaluate(() => ({
      pose: window.__drusnielClod?.getPose?.() ?? null,
      colliders: window.__drusnielClod?.stats?.counters["live_bubble_streamed_collider_pages"] ?? 0,
      failedPages: window.__drusnielClod?.stats?.counters["live_bubble_failed_pages"] ?? 0,
    }));
    const travelledM = (gameplayAfter.pose?.p[2] ?? 0) - (gameplayBefore.pose?.p[2] ?? 0);
    if (!gameplayBefore.pose || !gameplayAfter.pose || travelledM < 5
      || gameplayAfter.pose.p[1] < 15 || gameplayAfter.colliders < 1 || gameplayAfter.failedPages !== 0) {
      throw new Error(`cave gameplay route failed: ${JSON.stringify({ gameplayBefore, gameplayAfter, travelledM })}`);
    }
    const gameplay = { before: gameplayBefore, after: gameplayAfter, travelledM };
    console.log(`[phase5] cave gameplay route passed (${travelledM.toFixed(1)}m, ${gameplayAfter.colliders} collider pages)`);

    const report = {
      schemaVersion: 1,
      route: { target: [target.x, target.z], root: target.key, startupWorldPages: 2, configuredWorldPages: WORLD_PAGES },
      edit: { ...edit, streamRebuilds: streamRebuild.rebuilt },
      reloaded,
      gameplay,
      passed: true,
      generatedAt: new Date().toISOString(),
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[phase5] PASS ${OUT}`);
    completed = true;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
