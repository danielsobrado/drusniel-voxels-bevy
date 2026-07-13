import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clodUrl, launchWebGPU } from "./launch.js";

const outArg = process.argv.indexOf("--out");
const out = outArg >= 0 ? process.argv[outArg + 1] : undefined;
const { browser } = await launchWebGPU();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const url = clodUrl({
    scene: "continent",
    seed: 19,
    freeze: true,
    extra: { world: "8", startupWorld: "2", continentHydrology: "1" },
  });
  const samples: Array<Record<string, unknown>> = [];
  for (const label of ["cold", "warm"]) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.__drusnielStartupTimings?.["hydrology_graph_present"] === 1
        && window.__drusnielClod?.ready === true,
      undefined,
      { timeout: 300_000, polling: 250 },
    );
    const sample = await page.evaluate((runLabel) => ({
      label: runLabel,
      error: window.__drusnielClod?.error ?? null,
      manifest: window.__drusnielClod?.diag?.worldManifest ?? null,
      startup: window.__drusnielStartupTimings ?? null,
    }), label);
    samples.push(sample);
    if (sample.error) throw new Error(String(sample.error));
  }
  const report = { url, samples };
  console.log(JSON.stringify(report, null, 2));
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
  }
} finally {
  await browser.close();
}
