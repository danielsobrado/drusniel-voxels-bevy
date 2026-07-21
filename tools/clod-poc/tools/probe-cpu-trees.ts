// Temporary probe: verifies the CPU tree path (treeGpu=0) boots, renders foliage, and
// survives patch eviction/rebuild without console errors now that patch geometry shares
// the species/LOD template buffers. Delete after the diagnosis session.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2] ?? "?world=8&hud=0&treeGpu=0";
const outDir = process.argv[3] ?? "shots/cpu-trees";

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });

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
    await page.waitForTimeout(Number(process.env.STATIC_SETTLE_MS ?? 50000));
    mkdirSync(outDir, { recursive: true });

    const patchInfo = await page.evaluate(`(function(){
      var scene = window.__drusnielScene;
      var patches = 0, meshes = 0, sharedTagged = 0, totalVerts = 0;
      var untagged = [];
      // Object identity: a Map keyed by the BufferAttribute itself.
      var counts = new Map();
      scene.traverse(function(o){
        if (o.isGroup && (o.name||'').indexOf('tree-patch-') === 0) patches++;
        if (!o.isMesh || (o.name||'').indexOf('trees-') !== 0) return;
        meshes++;
        var g = o.geometry;
        if (g && g.userData && g.userData.treeSharedTemplateAttributes) sharedTagged++;
        else untagged.push(o.name);
        var p = g && g.attributes && g.attributes.position;
        if (p) {
          totalVerts += p.count;
          counts.set(p, (counts.get(p) || 0) + 1);
        }
      });
      var uniqueVerts = 0;
      var reuse = {};
      counts.forEach(function(n, attr){
        uniqueVerts += attr.count;
        reuse[n] = (reuse[n] || 0) + 1;
      });
      return {
        patchGroups: patches, treeMeshes: meshes, geometriesTaggedShared: sharedTagged,
        untaggedSample: untagged.slice(0, 8),
        uniquePositionBuffers: counts.size,
        vertsResident: uniqueVerts,
        vertsIfCloned: totalVerts,
        savingRatio: +(totalVerts / Math.max(1, uniqueVerts)).toFixed(1),
        meshesSharingEachBuffer: reuse
      };
    })()`);
    console.log("--- CPU tree path patch/geometry sharing ---");
    console.log(JSON.stringify(patchInfo, null, 2));

    const buf = await page.screenshot({ type: "png" });
    writeFileSync(`${outDir}/cpu-trees.png`, buf);
    const raw = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    let foliage = 0;
    const n = raw.data.length / raw.info.channels;
    for (let i = 0; i < n; i++) {
      const o = i * raw.info.channels;
      const r = raw.data[o], g = raw.data[o + 1], b = raw.data[o + 2];
      if (g > r + 8 && g > b + 8 && g > 20) foliage++;
    }
    console.log(`\nfoliage pixels: ${((foliage / n) * 100).toFixed(2)}% of frame`);

    // Hold longer so patch eviction/rebuild runs while sharing is active.
    await page.waitForTimeout(15000);
    console.log(`\nerrors captured: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
    console.log(`\n[cpu-trees] wrote ${outDir}/cpu-trees.png`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[cpu-trees] failed:", error);
  process.exitCode = 1;
});
