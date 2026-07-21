// Temporary probe: reports per-LOD tree instance counts, draw-call/triangle load and
// frame-time breakdown, to investigate the "only one LOD" and 9 FPS reports.
// Delete after the diagnosis session.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2] ?? "?oceanRim=0&sunLightCache=1&hud=1";

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    page.on("pageerror", (err) => console.error("[lodperf] pageerror:", err.message));
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      `(function(){
        var s = window.__drusnielScene; if (!s) return false;
        var n = 0; s.traverse(function(o){ if (o.isMesh && o.visible && (o.name||'').indexOf('tree') >= 0) n++; });
        return n > 0;
      })()`,
      undefined,
      { timeout: 300000, polling: 1000 },
    );
    await page.waitForTimeout(Number(process.env.STATIC_SETTLE_MS ?? 45000));

    // Per-LOD visible tree meshes, by mesh name suffix.
    const lodBreakdown = await page.evaluate(`(function(){
      var scene = window.__drusnielScene;
      var byLod = {}, byName = {}, totalTris = 0, meshes = 0;
      scene.traverse(function(o){
        if (!o.isMesh || !o.visible) return;
        var n = o.name || '';
        if (n.indexOf('tree') < 0) return;
        if (n.indexOf('shadow') >= 0) return; // shadow-only clones
        meshes++;
        byName[n] = (byName[n] || 0) + 1;
        var lod = 'other';
        ['near','mid','far','impostor'].forEach(function(l){ if (n.indexOf('-' + l) >= 0) lod = l; });
        var g = o.geometry;
        var inst = (g && g.instanceCount) || 0;
        var idx = (g && g.index && g.index.count) || 0;
        if (!byLod[lod]) byLod[lod] = { meshes: 0, instanceCapacity: 0, indexCount: 0 };
        byLod[lod].meshes++;
        byLod[lod].instanceCapacity += inst;
        byLod[lod].indexCount += idx;
        totalTris += (idx / 3) * (inst || 1);
      });
      return { byLod: byLod, visibleTreeMeshes: meshes, names: Object.keys(byName).slice(0, 24) };
    })()`);
    console.log("--- visible tree meshes by LOD (shadow clones excluded) ---");
    console.log(JSON.stringify(lodBreakdown, null, 2));

    const renderInfo = await page.evaluate(`(function(){
      var r = window.__drusnielRenderer || (window.__drusnielClod && window.__drusnielClod.renderer);
      if (r && r.info) return { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: (r.info.programs||[]).length, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
      return null;
    })()`);
    console.log(`\n--- renderer info ---\n${JSON.stringify(renderInfo)}`);

    // Frame pacing, camera untouched.
    const timing = await page.evaluate(`(function(){
      return new Promise(function(resolve){
        var t = [], last = performance.now(), n = 0;
        function tick(){ var now = performance.now(); t.push(now - last); last = now; n++;
          if (n < 90) requestAnimationFrame(tick); else resolve(t); }
        requestAnimationFrame(tick);
      });
    })()`) as number[];
    const s = timing.slice(10).sort((a, b) => a - b);
    console.log(
      `\n--- frame ms (static camera) ---\n` +
        `p50=${s[Math.floor(s.length * 0.5)].toFixed(1)} p95=${s[Math.floor(s.length * 0.95)].toFixed(1)} ` +
        `max=${s[s.length - 1].toFixed(1)} -> ~${(1000 / s[Math.floor(s.length * 0.5)]).toFixed(1)} fps`,
    );

    const perf = await page.evaluate(`(function(){
      var p = window.__drusnielPerf;
      if (!p || !p.snapshot) return null;
      var snap = p.snapshot();
      var out = {};
      for (var k in snap.metrics) { var m = snap.metrics[k]; if (m && m.p50 > 0.3) out[k] = { p50: +m.p50.toFixed(2), p95: +m.p95.toFixed(2) }; }
      return out;
    })()`);
    console.log(`\n--- perf buckets p50>0.3ms ---\n${JSON.stringify(perf, null, 2)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[lodperf] failed:", error);
  process.exitCode = 1;
});
