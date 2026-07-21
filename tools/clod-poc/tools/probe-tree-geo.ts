// Temporary probe: per-LOD tree geometry sizes vs configured vertex budgets, plus
// live draw-call/triangle stats. Delete after the diagnosis session.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2] ?? "?oceanRim=0&sunLightCache=1&hud=1";

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    page.on("pageerror", (err) => console.error("[geo] pageerror:", err.message));
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

    const geo = await page.evaluate(`(function(){
      var scene = window.__drusnielScene;
      var rows = [];
      scene.traverse(function(o){
        if (!o.isMesh || (o.name||'').indexOf('trees-ring-gpu-') !== 0) return;
        if ((o.name||'').indexOf('shadow') >= 0) return;
        var g = o.geometry;
        var pos = g && g.attributes && g.attributes.position;
        var variant = g && g.attributes && g.attributes.treeVariant;
        var idx = g && g.index;
        rows.push({
          name: o.name,
          visible: o.visible,
          vertices: pos ? pos.count : 0,
          indices: idx ? idx.count : 0,
          triangles: idx ? idx.count / 3 : 0,
          hasVariantAttr: !!variant,
          instanceCount: g ? g.instanceCount : null
        });
      });
      return rows;
    })()`) as any[];

    console.log("--- tree ring geometry per LOD ---");
    console.log("name".padEnd(34) + "vertices".padStart(10) + "triangles".padStart(11) + " variantAttr");
    for (const r of geo) {
      console.log(r.name.padEnd(34) + String(r.vertices).padStart(10) + String(r.triangles).padStart(11) + "   " + r.hasVariantAttr);
    }

    const byLod: Record<string, { v: number; t: number; n: number }> = {};
    for (const r of geo) {
      const lod = ["near", "mid", "far", "impostor"].find((l) => r.name.includes("-" + l)) ?? "other";
      byLod[lod] = byLod[lod] ?? { v: 0, t: 0, n: 0 };
      byLod[lod].v += r.vertices;
      byLod[lod].t += r.triangles;
      byLod[lod].n++;
    }
    console.log("\n--- per-LOD totals across 6 species (geometry is per-instance) ---");
    const BUDGET: Record<string, number> = { near: 180000, mid: 60000, far: 24000 };
    for (const [lod, v] of Object.entries(byLod)) {
      const perSpecies = Math.round(v.v / v.n);
      const budget = BUDGET[lod];
      const over = budget ? ` budget=${budget} -> ${(perSpecies / budget).toFixed(2)}x` : "";
      const perVariant = Math.round(perSpecies / 4);
      console.log(`  ${lod.padEnd(9)} verts/species=${String(perSpecies).padStart(8)}  (/4 variants = ${String(perVariant).padStart(7)})${over}`);
    }

    const stats = await page.evaluate(`(function(){
      var s = (window.__drusnielClod && window.__drusnielClod.stats) || null;
      if (!s) return null;
      return { fps: s.fps, frameMs: s.frameMs, drawCalls: s.drawCalls, triangles: s.triangles };
    })()`);
    console.log(`\n--- live stats ---\n${JSON.stringify(stats)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[geo] failed:", error);
  process.exitCode = 1;
});
