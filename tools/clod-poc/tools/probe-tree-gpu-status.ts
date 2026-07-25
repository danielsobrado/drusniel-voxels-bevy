// Answers one question: does the tree GPU ring exist, and if not, why?
//
// Every `trees.*` GPU counter in tree_system_stats.ts is gated on `input.gpuRing` being
// truthy (`stats.gpuVisibleCount = input.gpuRing ? ... : 0`), so a reading of 0 is
// ambiguous between "ring ran and accepted nothing" and "there is no ring". The ring's
// own `status` field distinguishes them, and every failure path routes through
// `reportTreeGpuFailure` -> `console.error("[trees-gpu-ring] ...")` with the reason.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
// perfProbe=1 exposes window.__drusnielPerf, whose lastSample carries `treeGpuStatus`
// (render_phase.ts) -- the ring's own status string, which no counter mirrors.
const query = process.argv[2] ?? "?gpuReadbacks=debug&oceanRim=0&customProps=1&perfProbe=1";
const WAIT_MS = Number(process.env.WAIT_MS ?? 120000);

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  const ringLogs: string[] = [];
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("trees-gpu-ring") || text.includes("tree-ring") || text.includes("treeGpu") || text.includes("tree-ring-stats-gate")) {
        if (ringLogs.length < 60) ringLogs.push(text);
      }
      if (msg.type() === "error" && errors.length < 40) errors.push(text);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });

    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const ready = await page.evaluate(`(function(){ var h=window.__drusnielClod; return !!(h && (h.ready===true||h.error)); })()`);
      if (ready) break;
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(4000);

    // The whole HUD, not a filtered subset: `path=<gpuStatus>` is what we are after and
    // the prior probe's line filter dropped it.
    const hud = await page.evaluate(`(function(){
      var hook = window.__drusnielClod || {};
      var stats = typeof hook.stats === 'function' ? hook.stats() : hook.stats;
      var counters = (stats && stats.counters) || {};
      var perf = window.__drusnielPerf || {};
      var last = perf.lastSample || {};
      return {
        treeGpuStatus: last.treeGpuStatus === undefined ? '(no perf sample)' : last.treeGpuStatus,
        treeTotalTrees: last.treeTotalTrees, treePatches: last.treePatches,
        sampleTreeGpuVisible: last.treeGpuVisibleCount, sampleTreeGpuCandidates: last.treeGpuCandidateCount,
        ready: hook.ready === true,
        error: hook.error || null,
        visible: counters['trees.visible'], candidates: counters['trees.candidates'],
        near: counters['trees.near'], mid: counters['trees.mid'], far: counters['trees.far'],
        impostor: counters['trees.impostor'], patches: counters['trees.patches'],
      };
    })()`) as Record<string, unknown>;

    console.log(`\n=== tree GPU ring status (${query}) ===`);
    console.log(`ready=${hud.ready} error=${JSON.stringify(hud.error)}`);
    console.log(`near=${hud.near} mid=${hud.mid} far=${hud.far} impostor=${hud.impostor} patches=${hud.patches} visible=${hud.visible} candidates=${hud.candidates}`);
    console.log(`\n>> treeGpuStatus = ${hud.treeGpuStatus}   (perf sample: totalTrees=${hud.treeTotalTrees} patches=${hud.treePatches} gpuVisible=${hud.sampleTreeGpuVisible} gpuCandidates=${hud.sampleTreeGpuCandidates})`);
    console.log(`\n-- [trees-gpu-ring] logs (${ringLogs.length}) --`);
    for (const l of ringLogs) console.log(`  ${l}`);
    console.log(`\n-- first console errors (${errors.length}) --`);
    for (const l of errors.slice(0, 15)) console.log(`  ${l.slice(0, 300)}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("[tree-gpu-status] failed:", e); process.exitCode = 1; });
