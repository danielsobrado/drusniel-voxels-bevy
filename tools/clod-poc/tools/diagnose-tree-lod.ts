import { clodUrl, launchWebGPU } from "./launch.js";

const url = clodUrl({
  scene: "trees-perf",
  freeze: true,
  extra: {
    quality: "balanced",
    treeGpu: "1",
    webgpuSelection: "1",
    treeGpuStrict: "1",
    treeGpuReadback: "1",
    treeGpuCounts: "1",
    treeGpuValidate: "0",
    treeWind: "0",
    cam: "512,116,732,0,-0.365,55",
  },
});
const { browser } = await launchWebGPU();
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__drusnielClod && (window.__drusnielClod.ready || window.__drusnielClod.error !== null),
    undefined,
    { timeout: 180_000, polling: 250 },
  );
  await page.evaluate(() => window.__drusnielClod?.setPose?.({
    p: [512, 116, 732],
    yaw: 0,
    pitch: -0.365,
    fov: 55,
  }));
  await page.evaluate(async () => window.__drusnielClod?.settle?.(600));
  await page.waitForFunction(
    () => Number(window.__drusnielClod?.stats?.counters?.["trees.candidates"] ?? 0) > 0,
    undefined,
    { timeout: 180_000, polling: 500 },
  );
  console.log(await page.evaluate(() => ({
    href: location.href,
    diag: window.__drusnielClod?.diag,
    error: window.__drusnielClod?.error,
    info: document.querySelector("#info")?.textContent,
    lod: (globalThis as typeof globalThis & { __treeRingLodProbe?: number[] }).__treeRingLodProbe,
    counts: Object.fromEntries(Object.entries(window.__drusnielClod?.stats?.counters ?? {}).filter(([key]) =>
      key.startsWith("trees.") || key.startsWith("gpu_tree") || key.startsWith("vegetation_ring"),
    )),
  })));
} finally {
  await browser.close();
}
