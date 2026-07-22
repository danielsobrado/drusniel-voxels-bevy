// Bisect pre-screen: does this commit actually compile the tree ring shader and render trees?
// Binary, unambiguous signal (WGSL compile error / tree mesh presence) — safe to automate,
// unlike the flicker metrics. Used to skip broken WIP commits without spending a human glance.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2] ?? "?oceanRim=0&webgpuSelection=1&materialTiers=1";
const WAIT_MS = Number(process.env.WAIT_MS ?? 90000);

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  const shaderErrors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    const capture = (t: string): void => {
      if (/unresolved call target|Error while parsing WGSL|CreateShaderModule|invalid due to a previous error/i.test(t)) {
        const first = t.split("\n")[0].slice(0, 160);
        if (!shaderErrors.includes(first)) shaderErrors.push(first);
      }
    };
    page.on("console", (m) => capture(m.text()));
    page.on("pageerror", (e) => capture(e.message));
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });

    let trees = 0;
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      trees = await page.evaluate(`(function(){ var s=window.__drusnielScene; if(!s) return 0; var n=0;
        s.traverse(function(o){ if(o.isMesh&&o.visible&&(o.name||'').indexOf('tree')>=0) n++; }); return n; })()`);
      if (trees > 0) break;
      await page.waitForTimeout(2000);
    }

    const broken = trees === 0 || shaderErrors.some((e) => /unresolved call target|parsing WGSL/i.test(e));
    console.log(`\n=== ${broken ? "BROKEN — SKIP" : "BUILDABLE — testable"} ===`);
    console.log(`tree meshes: ${trees}`);
    if (shaderErrors.length) {
      console.log(`shader/compile errors:`);
      for (const e of shaderErrors.slice(0, 6)) console.log(`  - ${e}`);
    } else console.log(`shader/compile errors: none`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("[screen] failed:", e); process.exitCode = 1; });
