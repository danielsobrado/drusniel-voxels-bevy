// Timeline of what happens before the tree GPU ring becomes live, to locate the ~70s gap
// between page load and the ring's first init. Samples cheap signals every 500ms so the
// ordering of startup milestones is visible rather than inferred.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2] ?? "?gpuReadbacks=debug&oceanRim=0&customProps=1";
const WAIT_MS = Number(process.env.WAIT_MS ?? 240000);

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  const t0 = Date.now();
  const at = () => ((Date.now() - t0) / 1000).toFixed(1);
  const events: string[] = [];
  const seen = new Set<string>();
  const mark = (label: string) => { if (!seen.has(label)) { seen.add(label); events.push(`[+${at()}s] ${label}`); } };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes("tree-ring-timeline")) events.push(`[+${at()}s] ${t}`);
    });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    mark("navigated");

    const deadline = Date.now() + WAIT_MS;
    let settled = false;
    while (Date.now() < deadline && !settled) {
      const s = await page.evaluate(`(function(){
        var hook = window.__drusnielClod || {};
        var stats = typeof hook.stats === 'function' ? hook.stats() : hook.stats;
        var c = (stats && stats.counters) || {};
        return {
          hookInstalled: !!window.__drusnielClod,
          ready: hook.ready === true,
          frame: stats && stats.frame,
          sceneMeshes: window.__drusnielScene ? 1 : 0,
          patches: c['trees.patches'], candidates: c['trees.candidates'],
          impostorStatus: c['tree_impostor_status'],
          builtL0: c['built_page_count_lod0'],
        };
      })()`) as Record<string, unknown>;
      if (s.hookInstalled) mark("hook installed");
      if (s.sceneMeshes) mark("scene exists");
      if ((s.frame as number) > 0) mark(`first frame rendered (frame=${s.frame})`);
      if (s.ready) mark("__drusnielClod.ready");
      if ((s.patches as number) > 0) mark(`CPU fallback patches appear (patches=${s.patches})`);
      if ((s.candidates as number) > 0) mark(`ring candidates>0 (${s.candidates})`);
      if ((s.patches as number) === 0 && (s.candidates as number) > 0) { mark("RING LIVE"); settled = true; }
      await page.waitForTimeout(500);
    }

    const timings = await page.evaluate(`(function(){ return window.__drusnielStartupTimings || null; })()`);
    console.log(`\n=== tree ring startup timeline (${query}) ===`);
    for (const e of events) console.log(`  ${e}`);
    console.log(`\n-- __drusnielStartupTimings --`);
    console.log(timings ? JSON.stringify(timings, null, 2) : "  (none)");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("[tree-ring-timeline] failed:", e); process.exitCode = 1; });
