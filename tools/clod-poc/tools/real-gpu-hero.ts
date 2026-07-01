// [DEBUG-tp5] TEMPORARY real-GPU hero-dolly FPS probe (TP-5 A/B). Delete after.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "shots/tp5";
const BASE = process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5180/";
const TAG = process.env["TP5_TAG"] ?? "run";
const HUD_JS = `(()=>{var t=document.body.innerText;var m=(re)=>{var x=t.match(re);return x?x[0].replace(/\\s+/g,' ').trim():'?';};return{lod:m(/n\\/m\\/f\\/i[^\\n]*/i),fps:m(/avg FPS[^\\n]*/i)};})()`;

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"] });
  const steps: Record<string, unknown>[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(`${BASE}?world=8&treeGpu=1&webgpuSelection=1&hud=1&seed=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(24000);
    await page.mouse.move(960, 540);
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(40); }
    await page.waitForTimeout(2000);
    for (let s = 0; s < 6; s++) {
      // read FPS twice (let EMA settle) and keep the second
      await page.waitForTimeout(1200);
      const hud = await page.evaluate(HUD_JS) as Record<string, unknown>;
      await page.screenshot({ path: `${OUT}/${TAG}-${s}.png` }).catch(() => undefined);
      steps.push({ step: s, ...hud });
      console.log(`[tp5:${TAG}] step ${s}: ${hud["fps"]} | ${hud["lod"]}`);
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(40); }
      await page.waitForTimeout(1500);
    }
    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(steps, null, 2));
  console.log(`[tp5:${TAG}] wrote ${OUT}/${TAG}.json`);
}
main().catch((e: unknown) => { console.error("[tp5] FAILED:", e instanceof Error ? e.stack : e); process.exit(1); });
