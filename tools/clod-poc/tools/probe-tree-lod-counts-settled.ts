// Per-LOD tree counts measured AFTER the GPU ring is actually live.
//
// The ring's `tree_cull` pipeline takes ~9s to compile and the ring does not even begin
// initialising until ~70s into startup, so probes that sample as soon as tree meshes exist
// (or as soon as `ready` flips) read the CPU-fallback patches and report zeros for every GPU
// counter. `trees.patches` is the discriminator: tree_system_stats.ts only increments it on
// the non-ring branch, so patches==0 with candidates>0 means the ring is the reporting path.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2] ?? "?gpuReadbacks=debug&oceanRim=0&customProps=1";
const WAIT_MS = Number(process.env.WAIT_MS ?? 300000);

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });

    const read = async () => await page.evaluate(`(function(){
      var hook = window.__drusnielClod || {};
      var stats = typeof hook.stats === 'function' ? hook.stats() : hook.stats;
      var c = (stats && stats.counters) || {};
      var out = {};
      Object.keys(c).forEach(function(k){ if (k.toLowerCase().indexOf('tree') >= 0) out[k] = c[k]; });
      return out;
    })()`) as Record<string, number>;

    const t0 = Date.now();
    let settledAtMs: number | null = null;
    let counters: Record<string, number> = {};
    while (Date.now() - t0 < WAIT_MS) {
      counters = await read();
      // Ring is the reporting path once it stops counting CPU patches and reports candidates.
      if ((counters["trees.patches"] ?? -1) === 0 && (counters["trees.candidates"] ?? 0) > 0) {
        settledAtMs = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(2000);
    }
    // Let the throttled 250ms counter mirror tick a few more times once live.
    if (settledAtMs !== null) { await page.waitForTimeout(5000); counters = await read(); }

    console.log(`\n=== tree LOD counts, ring-settled (${query}) ===`);
    console.log(settledAtMs === null
      ? `GPU ring NEVER became the reporting path within ${Math.round(WAIT_MS / 1000)}s (still CPU patches)`
      : `GPU ring became the reporting path after ${Math.round(settledAtMs / 1000)}s`);
    for (const k of Object.keys(counters).sort()) console.log(`  ${k} = ${counters[k]}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("[tree-lod-settled] failed:", e); process.exitCode = 1; });
