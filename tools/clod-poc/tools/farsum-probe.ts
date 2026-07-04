// [DEBUG-fs42] Temporary probe: attributes the farSummaryMs bracket via the
// farSum* sub-buckets. Usage: tsx tools/farsum-probe.ts "<query string>"
// Delete after the farSummary diagnosis session.
import { clodBaseUrl, launchWebGPU } from "./launch.js";

const query = process.argv[2] ?? "?perfProbe=1&perfWarmup=60&perfFrames=120";
const url = new URL(query, process.env.CLOD_POC_BASE_URL ?? clodBaseUrl()).toString();

const METRICS = [
  "frameMs",
  "farSummaryMs",
  "farSumTilesMs",
  "farSumNaadfMs",
  "farSumShellMs",
  "farSumShadowProxyMs",
  "farSumBiomeStreamMs",
  "farSumSunLightMs",
  "farSumStatsDomMs",
  "vegetationTotalMs",
  "renderMs",
] as const;

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.error("[farsum-probe] pageerror:", err.message));
    console.log(`[farsum-probe] loading ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => (window as unknown as { __drusnielPerf?: { ready: boolean } }).__drusnielPerf?.ready === true,
      undefined,
      { timeout: 300000, polling: 500 },
    );
    const result = await page.evaluate((metricNames: readonly string[]) => {
      const perf = (window as unknown as {
        __drusnielPerf: { snapshot(): { metrics: Record<string, { avg: number; p50: number; p95: number; max: number }>; sampleCount: number } };
      }).__drusnielPerf;
      const snapshot = perf.snapshot();
      const out: Record<string, unknown> = { sampleCount: snapshot.sampleCount };
      for (const name of metricNames) {
        const m = snapshot.metrics[name];
        out[name] = m
          ? { avg: Number(m.avg.toFixed(2)), p50: Number(m.p50.toFixed(2)), p95: Number(m.p95.toFixed(2)), max: Number(m.max.toFixed(2)) }
          : null;
      }
      return out;
    }, METRICS);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[farsum-probe] failed:", error);
  process.exitCode = 1;
});
