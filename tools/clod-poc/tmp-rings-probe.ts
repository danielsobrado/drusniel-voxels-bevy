// Temp probe: boot world=8, wait for the perf probe to settle, then screenshot
// and dump any stone/understory globals for visual + telemetry verification.
process.env["CLOD_POC_BASE_URL"] = process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5180/";
const { launchWebGPU } = await import("./tools/launch.js");

const base = process.env["CLOD_POC_BASE_URL"] ?? "http://127.0.0.1:5180/";
const shotPath = process.argv[2] ?? "shots/tmp-rings-verify.png";
const url = `${base}?world=8&seed=1&webgpuSelection=1&farShell=1&freeze=1&perfProbe=1&perfWarmup=60&perfFrames=60&gpuReadbacks=acceptance`;

const { browser } = await launchWebGPU();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const consoleIssues: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") consoleIssues.push(`${msg.type()}: ${msg.text()}`);
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => {
    const w = window as unknown as { __drusnielPerf?: { ready?: boolean }; __drusnielClod?: { error?: unknown } };
    return w.__drusnielPerf?.ready === true || !!w.__drusnielClod?.error;
  },
  null,
  { timeout: 150_000 },
);
await page.waitForTimeout(4000);
const result = await page.evaluate(`(() => {
  const w = window;
  const counters = (w.__drusnielClod && w.__drusnielClod.stats && w.__drusnielClod.stats.counters)
    || (w.__drusnielPerf && w.__drusnielPerf.snapshot && w.__drusnielPerf.snapshot().counters)
    || {};
  const pick = (needle) => Object.fromEntries(Object.entries(counters).filter(([k]) => k.toLowerCase().includes(needle)));
  return { error: (w.__drusnielClod && w.__drusnielClod.error) || null, stone: pick("stone"), understory: pick("understory") };
})()`);
await page.screenshot({ path: shotPath, fullPage: false });
console.log(JSON.stringify(result, null, 2));
console.log("shot:", shotPath);
console.log("console issues (first 12):", consoleIssues.slice(0, 12));
await browser.close();
