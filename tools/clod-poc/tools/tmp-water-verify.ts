// Temporary post-fix verification (delete after use): continent water config,
// stats counters, river cobbles, and a converged river shot.
import { mkdirSync } from "node:fs";
import { launchWebGPU, clodUrl } from "./launch.js";

async function main(): Promise<void> {
  const outDir = "qa-runs/water-live-probe";
  mkdirSync(outDir, { recursive: true });
  const { browser } = await launchWebGPU();
  let stoneErrors = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on("console", (msg) => {
      if (msg.text().includes("stone scatter params")) stoneErrors++;
      if (msg.type() === "error") console.log(`[page:error] ${msg.text().slice(0, 200)}`);
    });
    const url = clodUrl({ scene: "continent", seed: 1, hud: true, extra: { waterDebug: "1" } });
    console.log(`[verify] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const waitReady = async () => page.waitForFunction(
      () => (window as any).__drusnielClod && ((window as any).__drusnielClod.ready || (window as any).__drusnielClod.error !== null),
      undefined, { timeout: 420_000, polling: 500 },
    );
    await waitReady();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.waitForTimeout(5000);
        await waitReady();
        await page.evaluate(async () => (window as any).__drusnielClod?.settle?.(30));
        break;
      } catch { console.log("[verify] navigation during settle; re-waiting"); }
    }

    const state = await page.evaluate(() => {
      const w = window as any;
      const info = w.waterDebugInfo();
      const c = w.__drusnielClod?.stats?.counters ?? {};
      return {
        worldCells: info.worldCells,
        shoreSurfEnabled: info.shoreSurf.enabled,
        exclusionEnabled: info.clipmapExclusionBand.enabled,
        counters: {
          webgpu_uncaptured_errors: c.webgpu_uncaptured_errors ?? -1,
          water_clipmap_enabled: c.water_clipmap_enabled ?? -1,
          water_clipmap_visible_levels: c.water_clipmap_visible_levels ?? -1,
          water_clipmap_field_samples: c.water_clipmap_field_samples ?? -1,
          water_clipmap_full_refills: c.water_clipmap_full_refills ?? -1,
          cobbles_generated: c.dressing_river_cobbles_generated ?? -1,
          cobbles_accepted: c.dressing_river_cobbles_accepted ?? -1,
          cobbles_visible: c.dressing_river_cobbles_visible ?? -1,
        },
      };
    });
    console.log("[verify] state:", JSON.stringify(state, null, 2));

    // Converged shot at the known river spot (flowSpeed 0.70 pre-fix).
    await page.evaluate(() => {
      const w = window as any;
      const t = w.waterProbe(1254.4, 268.8);
      w.__drusnielClod?.setPose?.({ p: [1254.4 - 40, t.water + 25, 268.8 - 40], yaw: -Math.PI / 4, pitch: -0.45 });
    });
    await page.waitForFunction(() => {
      const c = (window as any).__drusnielClod?.stats?.counters ?? {};
      const safetyReq = Number(c.live_clod_stream_safety_required_pages ?? 0);
      const safetyReady = Number(c.live_clod_stream_safety_ready_pages ?? 0);
      return Number(c.far_summary_tiles_missing ?? 0) === 0
        && Number(c.far_summary_tiles_building ?? 0) === 0
        && (safetyReq === 0 || safetyReady >= safetyReq);
    }, undefined, { timeout: 180_000, polling: 500 }).catch(() => console.log("[verify] convergence timeout"));
    await page.evaluate(async () => (window as any).__drusnielClod?.settle?.(60));
    await page.screenshot({ path: `${outDir}/continent-river-fixed.png` });
    console.log(`[verify] shot ${outDir}/continent-river-fixed.png`);

    const after = await page.evaluate(() => {
      const c = (window as any).__drusnielClod?.stats?.counters ?? {};
      const s = (window as any).__drusnielClod?.stats ?? {};
      return {
        fps: s.fps, frameMs: s.frameMs,
        webgpu_uncaptured_errors: c.webgpu_uncaptured_errors ?? -1,
        water_clipmap_visible_levels: c.water_clipmap_visible_levels ?? -1,
        cobbles_accepted: c.dressing_river_cobbles_accepted ?? -1,
        cobbles_visible: c.dressing_river_cobbles_visible ?? -1,
      };
    });
    console.log("[verify] after teleport:", JSON.stringify(after));
    console.log(`[verify] stoneErrors=${stoneErrors}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[verify] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
