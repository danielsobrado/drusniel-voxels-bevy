// Temporary probe: captures consecutive frames with a COMPLETELY static camera and
// characterises the flicker — per-pixel speckle vs whole-tree brightness swing,
// its period, and which tree uniforms move. Delete after the diagnosis session.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2] ?? "?world=8&hud=0";
const FRAMES = Number(process.argv[3] ?? 24);
const outDir = process.argv[4] ?? "shots/static-flicker";

interface Frame { data: Buffer; w: number; h: number; ch: number }

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    page.on("pageerror", (err) => console.error("[static] pageerror:", err.message));
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    // The main app does not set __drusnielClod.ready (only gated scenes do), so
    // wait for the scene graph plus some visible tree meshes instead.
    await page.waitForFunction(
      `(function(){
        if (window.__drusnielClod && window.__drusnielClod.error) return true;
        var s = window.__drusnielScene; if (!s) return false;
        var n = 0; s.traverse(function(o){ if (o.isMesh && o.visible && (o.name||'').indexOf('tree') >= 0) n++; });
        return n > 0;
      })()`,
      undefined,
      { timeout: 300000, polling: 1000 },
    );
    const settleMs = Number(process.env.STATIC_SETTLE_MS ?? 40000);
    console.log(`[static] settling ${settleMs}ms before capture...`);
    await page.waitForTimeout(settleMs);

    mkdirSync(outDir, { recursive: true });
    const pose = await page.evaluate(
      "(window.__drusnielClod && window.__drusnielClod.getPose) ? window.__drusnielClod.getPose() : null",
    );
    console.log(`[static] pose: ${JSON.stringify(pose)}`);
    console.log("[static] camera is NOT touched during capture\n");

    const frames: Frame[] = [];
    const uniformLog: any[] = [];
    for (let i = 0; i < FRAMES; i++) {
      // advance exactly one rendered frame, no pose change
      await page.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const buf = await page.screenshot({ type: "png" });
      const raw = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      frames.push({ data: raw.data, w: raw.info.width, h: raw.info.height, ch: raw.info.channels });
      if (i < 4) writeFileSync(`${outDir}/f${String(i).padStart(2, "0")}.png`, buf);
      uniformLog.push(await page.evaluate(TREE_UNIFORM_SNAPSHOT));
    }

    analysePixels(frames, outDir);
    analyseUniforms(uniformLog);
  } finally {
    await browser.close();
  }
}

const TREE_UNIFORM_SNAPSHOT = `(function(){
  var scene = window.__drusnielScene;
  var out = [];
  var seen = {};
  scene && scene.traverse(function(o){
    if (!o.isMesh || !o.visible) return;
    if ((o.name||'').indexOf('tree') < 0) return;
    var mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (var i=0;i<mats.length;i++){
      var m = mats[i]; if (!m || seen[m.uuid]) continue; seen[m.uuid] = 1;
      var rec = { mesh: o.name, mat: m.name || m.type, uuid: m.uuid.slice(0,8) };
      if (m.uniforms) {
        for (var k in m.uniforms) {
          var v = m.uniforms[k] && m.uniforms[k].value;
          if (typeof v === 'number') rec[k] = +v.toFixed(5);
          else if (v && typeof v.x === 'number') rec[k] = [v.x,v.y,v.z].map(function(n){return +Number(n||0).toFixed(5);});
        }
      }
      var live = m.userData && m.userData.treeImpostorLiveLighting;
      if (live) { for (var k2 in live) { var lv = live[k2] && live[k2].value;
        if (typeof lv === 'number') rec['live_'+k2] = +lv.toFixed(5);
        else if (lv && typeof lv.x === 'number') rec['live_'+k2] = [lv.x,lv.y,lv.z].map(function(n){return +Number(n||0).toFixed(5);}); } }
      out.push(rec);
    }
  });
  return out;
})()`;

function analysePixels(frames: Frame[], outDir: string): void {
  const { w, h, ch } = frames[0];
  const n = w * h;
  const luma = frames.map((f) => {
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * ch;
      l[i] = 0.299 * f.data[o] + 0.587 * f.data[o + 1] + 0.114 * f.data[o + 2];
    }
    return l;
  });

  // Foliage mask: green-dominant in the median frame, and left of the GUI panel.
  const mid = luma.length >> 1;
  const midF = frames[mid];
  const mask = new Uint8Array(n);
  let maskCount = 0;
  for (let i = 0; i < n; i++) {
    const x = i % w;
    if (x > w * 0.78) continue; // skip GUI chrome on the right
    const o = i * ch;
    const r = midF.data[o], g = midF.data[o + 1], b = midF.data[o + 2];
    if (g > r + 6 && g > b + 6 && g > 18) { mask[i] = 1; maskCount++; }
  }
  console.log(`[static] foliage mask: ${maskCount} px (${((maskCount / n) * 100).toFixed(2)}% of frame)\n`);
  if (!maskCount) { console.log("[static] no foliage found — wrong view"); return; }

  // Per-pixel temporal stats over foliage.
  let sumRange = 0, flipping = 0, bigFlip = 0;
  const flipCounts: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    let lo = Infinity, hi = -Infinity, flips = 0;
    for (let t = 0; t < luma.length; t++) {
      const v = luma[t][i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (t > 1) {
        const d1 = luma[t][i] - luma[t - 1][i];
        const d2 = luma[t - 1][i] - luma[t - 2][i];
        if (d1 * d2 < 0 && Math.abs(d1) > 10) flips++; // direction reversal = oscillation
      }
    }
    sumRange += hi - lo;
    flipCounts.push(flips);
    if (hi - lo > 20) flipping++;
    if (hi - lo > 60) bigFlip++;
  }
  const meanRange = sumRange / maskCount;
  const meanFlips = flipCounts.reduce((a, b) => a + b, 0) / flipCounts.length;
  console.log("--- per-pixel temporal behaviour on foliage (static camera) ---");
  console.log(`mean luma range per pixel : ${meanRange.toFixed(1)} / 255`);
  console.log(`pixels swinging >20 luma  : ${((flipping / maskCount) * 100).toFixed(1)}%`);
  console.log(`pixels swinging >60 luma  : ${((bigFlip / maskCount) * 100).toFixed(1)}%  <- hard on/off flips`);
  console.log(`mean direction reversals  : ${meanFlips.toFixed(2)} over ${luma.length} frames\n`);

  // Per-frame-pair churn: a persistent blink changes pixels on EVERY pair;
  // residual settling concentrates the changes in the early pairs.
  console.log("--- foliage pixels changing >60 luma, per consecutive frame pair ---");
  const pairCounts: number[] = [];
  for (let t = 1; t < luma.length; t++) {
    let c = 0;
    for (let i = 0; i < n; i++) if (mask[i] && Math.abs(luma[t][i] - luma[t - 1][i]) > 60) c++;
    pairCounts.push(c);
  }
  pairCounts.forEach((c, t) => {
    const pctv = (c / maskCount) * 100;
    console.log(`  f${String(t).padStart(2)}->f${String(t + 1).padStart(2)}  ${String(c).padStart(6)} px  ${pctv.toFixed(2).padStart(5)}%  ${"#".repeat(Math.round(pctv * 8))}`);
  });
  const firstHalf = pairCounts.slice(0, pairCounts.length >> 1).reduce((a, b) => a + b, 0);
  const secondHalf = pairCounts.slice(pairCounts.length >> 1).reduce((a, b) => a + b, 0);
  console.log(`\nfirst half total=${firstHalf}  second half total=${secondHalf}`);
  console.log(secondHalf > firstHalf * 0.5
    ? ">>> churn is SUSTAINED across the window -> a real ongoing blink"
    : ">>> churn decays -> residual settling, not an ongoing blink");
  console.log("");

  // Whole-canopy mean brightness per frame: is the entire canopy pulsing together?
  console.log("--- whole-canopy mean brightness per frame ---");
  const means: number[] = [];
  for (let t = 0; t < luma.length; t++) {
    let s = 0;
    for (let i = 0; i < n; i++) if (mask[i]) s += luma[t][i];
    means.push(s / maskCount);
  }
  const mLo = Math.min(...means), mHi = Math.max(...means);
  means.forEach((m, t) => {
    const bar = "#".repeat(Math.max(0, Math.round((m - mLo) * 40 / Math.max(0.01, mHi - mLo))));
    console.log(`  f${String(t).padStart(2)} ${m.toFixed(2).padStart(7)} ${bar}`);
  });
  console.log(`\ncanopy mean swing: ${(mHi - mLo).toFixed(2)} luma (${(((mHi - mLo) / ((mHi + mLo) / 2)) * 100).toFixed(1)}% of mean)`);
  console.log(mHi - mLo > 3
    ? ">>> WHOLE CANOPY pulses together -> a lighting term is oscillating"
    : ">>> canopy mean is steady -> flicker is per-pixel speckle, not a global light swing");

  // Write a visualisation of per-pixel range.
  const vis = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < luma.length; t++) { const v = luma[t][i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const r = Math.min(255, (hi - lo) * 3);
    vis[i * 3] = r; vis[i * 3 + 1] = mask[i] ? r * 0.4 : 0; vis[i * 3 + 2] = 0;
  }
  sharp(vis, { raw: { width: w, height: h, channels: 3 } }).png().toFile(`${outDir}/flicker-heatmap.png`);
  console.log(`\n[static] wrote ${outDir}/flicker-heatmap.png (red = pixels that swing)`);
}

function analyseUniforms(log: any[]): void {
  console.log("\n--- tree material uniforms that CHANGE across frames (static camera) ---");
  const byMat = new Map<string, any[]>();
  for (const frame of log) for (const rec of frame) {
    const key = `${rec.mesh} :: ${rec.mat} :: ${rec.uuid}`;
    if (!byMat.has(key)) byMat.set(key, []);
    byMat.get(key)!.push(rec);
  }
  let anyChanged = false;
  for (const [key, recs] of byMat) {
    const keys = new Set<string>();
    for (const r of recs) for (const k of Object.keys(r)) if (!["mesh", "mat", "uuid"].includes(k)) keys.add(k);
    const changed: string[] = [];
    for (const k of keys) {
      const vals = new Set(recs.map((r) => JSON.stringify(r[k])));
      if (vals.size > 1) changed.push(`${k}(${vals.size} vals: ${[...vals].slice(0, 3).join(" ")})`);
    }
    if (changed.length) { anyChanged = true; console.log(`  ${key}\n     ${changed.join("\n     ")}`); }
  }
  if (!anyChanged) console.log("  (none — every tree uniform is constant; flicker is not uniform-driven)");
}

main().catch((error) => {
  console.error("[static] failed:", error);
  process.exitCode = 1;
});
