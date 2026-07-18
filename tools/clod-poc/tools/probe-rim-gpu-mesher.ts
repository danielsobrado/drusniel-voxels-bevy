// Minimal reproduction harness for the rim-page GPU root-mesher DegenerateGeometry
// failures recorded in the LM3 coast-to-coast calibration (e.g. L0:-126,0, L0:124,0,
// L0:140,4). Boots the canonical unified-streaming scene, then builds the requested
// pages through both the GPU mesher and the CPU worker via the
// __drusnielClod.compareStreamRootBuilds diagnostic hook and reports both outcomes.
// Usage:
//   npm run probe:rim-gpu-mesher -- --pages "-126,0;124,0;140,4" --out shots/long-map-precision/rim-mesher-compare.json
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clodUrl, launchWebGPU } from "./launch.js";

interface PageCoord {
  px: number;
  pz: number;
  level?: number;
}

function parsePages(raw: string | undefined): PageCoord[] {
  const text = raw ?? "-126,0;124,0;140,4;146,4";
  return text.split(";").map((entry) => {
    const [levelText, coordinates] = entry.includes(":") ? entry.split(":", 2) : [undefined, entry];
    const [px, pz] = coordinates!.split(",").map((value) => Number(value.trim()));
    const level = levelText === undefined ? undefined : Number(levelText);
    if (!Number.isInteger(px) || !Number.isInteger(pz) || (level !== undefined && !Number.isInteger(level))) {
      throw new Error(`invalid page coord: ${entry}`);
    }
    return level === undefined ? { px, pz } : { px, pz, level };
  });
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pages = parsePages(argValue("pages"));
const out = argValue("out") ?? "shots/long-map-precision/rim-mesher-compare.json";

const { browser } = await launchWebGPU();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const consoleWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") consoleWarnings.push(message.text());
  });
  const url = clodUrl({
    scene: "infinite-islands",
    seed: 1,
    extra: {
      world: "16",
      startupWorld: "2",
      clodPerf: "1",
      webgpuSelection: "1",
      farSummaryLayout: "2",
      farClipmap: "1",
      farClipmapMode: "replace",
    },
  });
  console.log(`[probe-rim-gpu-mesher] ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const hooks = window.__drusnielClod;
    return hooks?.ready === true || hooks?.error != null;
  }, undefined, { timeout: 600_000, polling: 500 });
  const bootError = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (bootError) throw new Error(`boot failed: ${bootError}`);

  const comparisons = await page.evaluate(async (coords) => {
    const hooks = window.__drusnielClod;
    if (!hooks?.compareStreamRootBuilds) throw new Error("compareStreamRootBuilds hook unavailable");
    return await hooks.compareStreamRootBuilds(coords);
  }, pages);

  const report = {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    url,
    pages: comparisons,
    console_warnings: consoleWarnings.filter((text) => /clod-stream-gpu|Degenerate/i.test(text)),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[probe-rim-gpu-mesher] wrote ${out}`);
  for (const comparison of comparisons) {
    const gpu = comparison.gpu.ok
      ? `gpu ok tris=${comparison.gpu.triangles} y=[${comparison.gpu.minY?.toFixed(1)},${comparison.gpu.maxY?.toFixed(1)}]`
      : `gpu FAIL ${comparison.gpu.error}`;
    const cpu = comparison.cpu.ok
      ? `cpu ok tris=${comparison.cpu.triangles} y=[${comparison.cpu.minY?.toFixed(1)},${comparison.cpu.maxY?.toFixed(1)}]`
      : `cpu FAIL ${comparison.cpu.error}`;
    console.log(`  ${comparison.id}: ${gpu} | ${cpu}`);
  }
} finally {
  await browser.close();
}
