// Captures the tree GPU-ring per-LOD counters without a human reading the HUD.
//
// The counters are only requested when `?gpuReadbacks=debug` is set: enabling them through
// the `readbackVisibleLists` GUI toggle is a GPU resource change that tears the ring down
// and blacks out the view, so the URL form is the only way to measure without breaking the
// thing being measured.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
// customProps=1 installs the __drusnielClod automation hooks; without it stats are absent.
const query = process.argv[2] ?? "?gpuReadbacks=debug&oceanRim=0&customProps=1";
const WAIT_MS = Number(process.env.WAIT_MS ?? 120000);

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for tree meshes to exist, then let the throttled counter mirror tick.
    const deadline = Date.now() + WAIT_MS;
    let trees = 0;
    while (Date.now() < deadline) {
      trees = await page.evaluate(`(function(){ var s=window.__drusnielScene; if(!s) return 0; var n=0;
        s.traverse(function(o){ if(o.isMesh&&o.visible&&(o.name||'').indexOf('tree')>=0) n++; }); return n; })()`);
      if (trees > 0) break;
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(3000);

    const result = await page.evaluate(`(function(){
      var hook = window.__drusnielClod || {};
      var stats = typeof hook.stats === 'function' ? hook.stats() : hook.stats;
      var counters = (stats && stats.counters) || {};
      var treeCounters = {};
      Object.keys(counters).forEach(function(k){ if (k.toLowerCase().indexOf('tree') >= 0) treeCounters[k] = counters[k]; });
      // The HUD line is the same text a human would read off the debug panel.
      var hud = (document.body.innerText || '').split('\\n').map(function(l){ return l.trim(); })
        .filter(function(l){ return /^(trees:|imp-baked|tree impostors:|visible=)/.test(l); });
      return { treeCounters: treeCounters, hud: hud, ready: hook.ready === true, error: hook.error || null };
    })()`);

    console.log(`\n=== tree LOD counts (${query}) ===`);
    console.log(`tree meshes in scene: ${trees}   ready=${(result as any).ready}`);
    if ((result as any).error) console.log(`hook error: ${JSON.stringify((result as any).error)}`);
    const hud = (result as any).hud as string[];
    console.log(`\n-- HUD lines --`);
    if (hud.length) for (const line of hud) console.log(`  ${line}`);
    else console.log("  (none matched)");
    const counters = (result as any).treeCounters as Record<string, unknown>;
    const keys = Object.keys(counters).sort();
    console.log(`\n-- tree counters (${keys.length}) --`);
    if (keys.length) for (const k of keys) console.log(`  ${k} = ${String(counters[k])}`);
    else console.log("  (none)");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("[tree-lod-counts] failed:", e); process.exitCode = 1; });
