// [DEBUG-bs9f] TEMPORARY automated FPS differential. Delete after diagnosis.
// Drives the real app path (NO freeze) so vegetation renders, settles each page,
// then measures frame throughput via rAF and scrapes the HUD.
import { mkdirSync, writeFileSync } from "node:fs";
import { launchWebGPU, clodBaseUrl } from "./launch.js";

interface CaseDef { name: string; query: string }

const BASE = "world=8&seed=1&webgpuSelection=1&farShell=1";
const CASES: CaseDef[] = [
  { name: "0-baseline", query: BASE },
  { name: "E-sunShadows-off", query: `${BASE}&sunShadows=0` },
  { name: "F-ablate-shadows", query: `${BASE}&ablate=shadows` },
  { name: "G-trees-off", query: `${BASE}&trees=0&understory=0` },
  { name: "H-trees-1500", query: `${BASE}&treeGpuMaxVisible=1500` },
  { name: "I-tree-dist-150", query: `${BASE}&treeDistance=150` },
];

const SETTLE_MS = 18000; // generous: CLOD cache + hydrology + tree/grass dispatch settle
const MEASURE_MS = 5000;

interface Result { name: string; rafFps: number; hudFps: string; hudTris: string; error?: string }

function scrape(text: string, label: RegExp): string {
  const m = text.match(label);
  return m ? m[1]!.trim() : "?";
}

async function main(): Promise<void> {
  const outDir = "F:/drusniel-cache/tmp/claude/f--Development-workspace-GitHub-drusniel-voxels-bevy/02e8e825-b77d-4092-aa3e-2a27959146be/scratchpad";
  const base = clodBaseUrl();
  const { browser } = await launchWebGPU();
  const results: Result[] = [];
  try {
    for (const c of CASES) {
      const url = `${base}${base.includes("?") ? "&" : "?"}${c.query}`;
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
      try {
        console.log(`[diff-fps] ${c.name}: loading ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(SETTLE_MS);
        // Strings (not functions) so esbuild/tsx does not inject __name helpers into page context.
        const rafFps = await page.evaluate(
          `new Promise((resolve)=>{var frames=0;var start=performance.now();function tick(){frames++;var el=performance.now()-start;if(el>=${MEASURE_MS}){resolve(frames/el*1000);}else{requestAnimationFrame(tick);}}requestAnimationFrame(tick);})`,
        ) as number;
        const text = await page.evaluate("document.body.innerText") as string;
        const hudFps = scrape(text, /avg FPS[:\s]*([\d.]+)/i);
        const hudTris = scrape(text, /tris rendered[:\s]*([\d,]+)/i);
        await page.screenshot({ path: `${outDir}/diff-${c.name}.png` }).catch(() => undefined);
        const r: Result = { name: c.name, rafFps: Math.round(rafFps * 10) / 10, hudFps, hudTris };
        results.push(r);
        console.log(`[diff-fps] ${c.name}: rafFps=${r.rafFps} hudFps=${r.hudFps} hudTris=${r.hudTris}`);
      } catch (e) {
        results.push({ name: c.name, rafFps: 0, hudFps: "?", hudTris: "?", error: e instanceof Error ? e.message : String(e) });
        console.log(`[diff-fps] ${c.name}: ERROR ${e instanceof Error ? e.message : e}`);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  console.log("\n===== FPS DIFFERENTIAL (headless software GPU) =====");
  console.log("| case | rAF fps | HUD avg fps | HUD tris |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const r of results) console.log(`| ${r.name} | ${r.rafFps}${r.error ? " (err)" : ""} | ${r.hudFps} | ${r.hudTris} |`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/diff-fps.json`, JSON.stringify(results, null, 2));
}

main().catch((e: unknown) => { console.error("[diff-fps] FAILED:", e instanceof Error ? e.stack : e); process.exit(1); });
