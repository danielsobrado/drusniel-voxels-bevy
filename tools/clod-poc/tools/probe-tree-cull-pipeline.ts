// Waits (long) for the `tree_cull` compute pipeline to finish compiling, to separate a true
// backend deadlock from a pathologically slow shader compile. The other two entry points on
// the same module/layout resolve in milliseconds.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2] ?? "?gpuReadbacks=debug&oceanRim=0&customProps=1";
const WAIT_MS = Number(process.env.WAIT_MS ?? 600000);

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  const lines: string[] = [];
  let cullSettled = false;
  const t0 = Date.now();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    page.on("console", (msg) => {
      const text = msg.text();
      if (!text.includes("tree-ring-init")) return;
      lines.push(`[+${Math.round((Date.now() - t0) / 1000)}s] ${text}`);
      if (text.includes("tree_cull") && (text.includes("pipeline OK") || text.includes("pipeline FAIL"))) cullSettled = true;
    });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });

    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline && !cullSettled) await page.waitForTimeout(5000);

    console.log(`\n=== tree_cull pipeline compile watch (waited ${Math.round((Date.now() - t0) / 1000)}s) ===`);
    console.log(cullSettled ? "tree_cull SETTLED" : "tree_cull NEVER SETTLED (deadlock)");
    for (const l of lines) console.log(`  ${l}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("[tree-cull-pipeline] failed:", e); process.exitCode = 1; });
