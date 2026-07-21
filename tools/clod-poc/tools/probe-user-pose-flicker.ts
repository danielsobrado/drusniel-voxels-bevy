// Reproduce the in-canopy camera pose (default X256 Z34 Z263, among the trunks) and
// characterise the per-frame texture/shadow flicker there. Saves frames + heatmap.
// Requires customProps=1 in the query so the setPose automation hook is installed.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2] ?? "?oceanRim=0&customProps=1";
const FRAMES = Number(process.argv[3] ?? 24);
const outDir = process.argv[4] ?? "shots/user-pose";
const POSE = {
  p: [Number(process.env.CAMX ?? 256), Number(process.env.CAMY ?? 34), Number(process.env.CAMZ ?? 263)],
  yaw: Number(process.env.YAW ?? 0.6),
  pitch: Number(process.env.PITCH ?? -0.12),
  fov: 55,
};

interface Frame { data: Buffer; w: number; h: number; ch: number }

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    page.on("pageerror", (e) => console.error("[pose] pageerror:", e.message));
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      `(function(){ var s=window.__drusnielScene; if(!s) return false; var n=0; s.traverse(function(o){ if(o.isMesh&&o.visible&&(o.name||'').indexOf('tree')>=0) n++; }); return n>0; })()`,
      undefined, { timeout: 300000, polling: 1000 },
    );
    await page.waitForFunction(
      `typeof window.__drusnielClod?.setPose === 'function'`,
      undefined, { timeout: 120000, polling: 500 },
    ).catch(() => console.error("[pose] setPose hook never appeared"));
    await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 25000));

    const posed = await page.evaluate(`(function(pose){
      var h = window.__drusnielClod;
      if (h && typeof h.setPose === 'function') { h.setPose(pose); return 'setPose ok'; }
      return 'setPose unavailable';
    })(${JSON.stringify(POSE)})`);
    console.log(`[pose] ${posed}  target=${JSON.stringify(POSE)}`);
    await page.waitForTimeout(2500);

    mkdirSync(outDir, { recursive: true });
    const frames: Frame[] = [];
    for (let i = 0; i < FRAMES; i++) {
      await page.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const buf = await page.screenshot({ type: "png" });
      const raw = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      frames.push({ data: raw.data, w: raw.info.width, h: raw.info.height, ch: raw.info.channels });
      if (i < 4) writeFileSync(`${outDir}/f${String(i).padStart(2, "0")}.png`, buf);
    }
    analyse(frames, outDir);
  } finally {
    await browser.close();
  }
}

function analyse(frames: Frame[], outDir: string): void {
  const { w, h, ch } = frames[0];
  const n = w * h;
  const luma = frames.map((f) => {
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) { const o = i * ch; l[i] = 0.299 * f.data[o] + 0.587 * f.data[o + 1] + 0.114 * f.data[o + 2]; }
    return l;
  });
  // Analyse the left 82% of the frame (skip the GUI chrome on the right).
  const mask = new Uint8Array(n); let maskCount = 0;
  for (let i = 0; i < n; i++) { if ((i % w) < w * 0.82) { mask[i] = 1; maskCount++; } }

  let sumRange = 0, big = 0, mid = 0;
  const pairChurn: number[] = new Array(luma.length - 1).fill(0);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < luma.length; t++) {
      const v = luma[t][i];
      if (v < lo) lo = v; if (v > hi) hi = v;
      if (t > 0 && Math.abs(luma[t][i] - luma[t - 1][i]) > 60) pairChurn[t - 1]++;
    }
    sumRange += hi - lo; if (hi - lo > 20) mid++; if (hi - lo > 60) big++;
  }
  console.log(`\n[pose] analysed region: ${maskCount} px`);
  console.log(`mean per-pixel luma range : ${(sumRange / maskCount).toFixed(1)} / 255`);
  console.log(`pixels swinging >20 luma  : ${((mid / maskCount) * 100).toFixed(1)}%`);
  console.log(`pixels swinging >60 luma  : ${((big / maskCount) * 100).toFixed(1)}%  <- hard flips`);
  const avgPair = pairChurn.reduce((a, b) => a + b, 0) / pairChurn.length;
  console.log(`avg pixels flipping >60/frame-pair: ${avgPair.toFixed(0)} (${((avgPair / maskCount) * 100).toFixed(2)}%)`);

  const vis = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < luma.length; t++) { const v = luma[t][i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    vis[i * 3] = Math.min(255, (hi - lo) * 3); vis[i * 3 + 1] = 0; vis[i * 3 + 2] = 0;
  }
  sharp(vis, { raw: { width: w, height: h, channels: 3 } }).png().toFile(`${outDir}/flicker-heatmap.png`);
  console.log(`[pose] wrote ${outDir}/flicker-heatmap.png + f00..f03.png`);
}

main().catch((e) => { console.error("[pose] failed:", e); process.exitCode = 1; });
