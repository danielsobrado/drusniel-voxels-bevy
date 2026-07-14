import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";

const DEFAULT_TIMEOUT_MS = 240_000;
const POLL_MS = 500;
const SOFTWARE_ADAPTER_PATTERNS = [
  /swiftshader/i,
  /llvmpipe/i,
  /softpipe/i,
  /lavapipe/i,
  /\bwarp\b/i,
  /microsoft basic render/i,
  /software raster/i,
  /software adapter/i,
  /mesa offscreen/i,
] as const;

interface Options {
  timeoutMs: number;
  jsonOut: string;
  markdownOut: string;
}

interface AdapterIdentity {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

interface ResidentCounters {
  hierarchyEnabled: number;
  hierarchyFailures: number;
  hierarchyRuntimeDisabled: number;
  residentPages: number;
  residentBytes: number;
  residentAdoptedTotal: number;
  residentRenderViewsTotal: number;
  indirectRenderViewsTotal: number;
  meshletsResident: number;
  hierarchyNodesResident: number;
  streamRequiredPages: number;
  streamReadyPages: number;
  streamPendingPages: number;
  streamInflightBatches: number;
  streamFailedPages: number;
  streamFallbackPages: number;
  streamWorkerFallbackPages: number;
  geometryReadbackMsP95: number;
  countReadbackMsP95: number;
  buildMsP95: number;
}

interface EvidenceReport {
  schemaVersion: 1;
  generatedAt: string;
  sourceCommit: string;
  url: string;
  elapsedMs: number;
  adapter: AdapterIdentity;
  launch: { headless: boolean; channel?: string; cdpUrl?: string };
  counters: ResidentCounters;
  validation: { ok: boolean; errors: string[] };
}

function valueArg(argv: readonly string[], key: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1);
}

function parseOptions(argv: readonly string[]): Options {
  const timeout = Number(valueArg(argv, "--timeout-ms"));
  return {
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
    jsonOut: resolve(valueArg(argv, "--out-json") ?? "perf-runs/gpu-clod-resident/hardware-summary.json"),
    markdownOut: resolve(valueArg(argv, "--out-md") ?? "docs/performance/gpu-clod-resident-hardware-latest.md"),
  };
}

function adapterText(adapter: AdapterIdentity): string {
  return [adapter.vendor, adapter.architecture, adapter.device, adapter.description]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}

async function readAdapter(page: Page): Promise<AdapterIdentity> {
  return await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    const info = adapter?.info;
    return {
      vendor: info?.vendor,
      architecture: info?.architecture,
      device: info?.device,
      description: info?.description,
    };
  });
}

async function readCounters(page: Page): Promise<ResidentCounters> {
  return await page.evaluate(() => {
    const counters = (window as typeof window & {
      __drusnielClod?: { stats?: { counters?: Record<string, number> } };
    }).__drusnielClod?.stats?.counters ?? {};
    const value = (key: string) => Number(counters[key] ?? 0);
    return {
      hierarchyEnabled: value("live_clod_gpu_hierarchy_enabled"),
      hierarchyFailures: value("live_clod_gpu_hierarchy_failures_total"),
      hierarchyRuntimeDisabled: value("live_clod_gpu_hierarchy_runtime_disabled"),
      residentPages: value("live_clod_gpu_resident_pages"),
      residentBytes: value("live_clod_gpu_resident_bytes"),
      residentAdoptedTotal: value("live_clod_gpu_resident_adopted_total"),
      residentRenderViewsTotal: value("live_clod_gpu_resident_render_views_total"),
      indirectRenderViewsTotal: value("live_clod_gpu_indirect_render_views_total"),
      meshletsResident: value("live_clod_gpu_meshlets_resident"),
      hierarchyNodesResident: value("live_clod_gpu_hierarchy_nodes_resident"),
      streamRequiredPages: value("live_clod_stream_required_pages"),
      streamReadyPages: value("live_clod_stream_ready_pages"),
      streamPendingPages: value("live_clod_stream_pending_pages"),
      streamInflightBatches: value("live_clod_stream_inflight_batches"),
      streamFailedPages: value("live_clod_stream_failed_pages"),
      streamFallbackPages: value("live_clod_stream_gpu_fallback_pages"),
      streamWorkerFallbackPages: value("live_clod_stream_worker_fallback_pages"),
      geometryReadbackMsP95: value("live_clod_stream_gpu_geometry_readback_ms_p95"),
      countReadbackMsP95: value("live_clod_stream_gpu_count_readback_ms_p95"),
      buildMsP95: value("live_clod_stream_gpu_build_ms_p95"),
    } satisfies ResidentCounters;
  });
}

function isSettled(counters: ResidentCounters): boolean {
  return counters.hierarchyEnabled === 1
    && counters.hierarchyFailures === 0
    && counters.hierarchyRuntimeDisabled === 0
    && counters.streamRequiredPages > 0
    && counters.streamReadyPages > 0
    && counters.streamPendingPages === 0
    && counters.streamInflightBatches === 0
    && counters.streamFailedPages === 0
    && counters.residentPages > 0
    && counters.residentBytes > 0
    && counters.residentAdoptedTotal > 0
    && counters.residentRenderViewsTotal > 0
    && counters.indirectRenderViewsTotal > 0
    && counters.meshletsResident > 0
    && counters.hierarchyNodesResident > 0;
}

async function waitForResidentRuntime(page: Page, timeoutMs: number): Promise<ResidentCounters> {
  const deadline = Date.now() + timeoutMs;
  let latest = await readCounters(page);
  while (Date.now() < deadline) {
    latest = await readCounters(page);
    if (isSettled(latest)) return latest;
    await page.waitForTimeout(POLL_MS);
  }
  throw new Error(`resident runtime did not settle: ${JSON.stringify(latest)}`);
}

function validate(adapter: AdapterIdentity, counters: ResidentCounters): string[] {
  const errors: string[] = [];
  const identity = adapterText(adapter);
  if (!identity) errors.push("WebGPU adapter identity is empty");
  if (SOFTWARE_ADAPTER_PATTERNS.some((pattern) => pattern.test(identity))) {
    errors.push(`software adapter is not hardware evidence: ${identity}`);
  }
  if (counters.hierarchyEnabled !== 1) errors.push("resident hierarchy did not enable");
  if (counters.hierarchyFailures !== 0) errors.push(`hierarchy failures=${counters.hierarchyFailures}`);
  if (counters.hierarchyRuntimeDisabled !== 0) errors.push("resident hierarchy disabled itself at runtime");
  if (counters.streamFailedPages !== 0) errors.push(`stream failed pages=${counters.streamFailedPages}`);
  if (counters.streamFallbackPages !== 0) errors.push(`GPU fallback pages=${counters.streamFallbackPages}`);
  if (counters.streamWorkerFallbackPages !== 0) errors.push(`worker fallback pages=${counters.streamWorkerFallbackPages}`);
  if (counters.residentPages <= 0 || counters.residentBytes <= 0) errors.push("no resident GPU pages were retained");
  if (counters.residentRenderViewsTotal <= 0) errors.push("no resident page was imported into Three WebGPU");
  if (counters.indirectRenderViewsTotal <= 0) errors.push("no indexed-indirect resident view was created");
  if (counters.meshletsResident <= 0) errors.push("no resident meshlets were generated");
  if (counters.hierarchyNodesResident <= 0) errors.push("no resident meshlet hierarchy nodes were generated");
  if (counters.streamReadyPages < counters.streamRequiredPages) {
    errors.push(`ready pages ${counters.streamReadyPages} below required ${counters.streamRequiredPages}`);
  }
  return errors;
}

function renderMarkdown(report: EvidenceReport): string {
  const c = report.counters;
  return `# GPU CLOD Resident Runtime Hardware Evidence\n\n`
    + `- Source commit: \`${report.sourceCommit}\`\n`
    + `- Captured: ${report.generatedAt}\n`
    + `- Adapter: ${adapterText(report.adapter)}\n`
    + `- Browser mode: ${report.launch.headless ? "headless" : "headed"}\n`
    + `- Result: **${report.validation.ok ? "PASS" : "FAIL"}**\n`
    + `- Elapsed: ${report.elapsedMs.toFixed(0)} ms\n\n`
    + `## Runtime counters\n\n`
    + `| Counter | Value |\n| --- | ---: |\n`
    + `| Resident pages | ${c.residentPages} |\n`
    + `| Resident bytes | ${c.residentBytes} |\n`
    + `| Adopted pages total | ${c.residentAdoptedTotal} |\n`
    + `| Resident render views | ${c.residentRenderViewsTotal} |\n`
    + `| Indexed-indirect views | ${c.indirectRenderViewsTotal} |\n`
    + `| Meshlets resident | ${c.meshletsResident} |\n`
    + `| Hierarchy nodes resident | ${c.hierarchyNodesResident} |\n`
    + `| Required / ready pages | ${c.streamRequiredPages} / ${c.streamReadyPages} |\n`
    + `| GPU build p95 ms | ${c.buildMsP95} |\n`
    + `| Count readback p95 ms | ${c.countReadbackMsP95} |\n`
    + `| Selective geometry readback p95 ms | ${c.geometryReadbackMsP95} |\n`
    + `| Hierarchy failures | ${c.hierarchyFailures} |\n`
    + `| GPU fallback pages | ${c.streamFallbackPages} |\n`
    + `| Worker fallback pages | ${c.streamWorkerFallbackPages} |\n\n`
    + (report.validation.errors.length > 0
      ? `## Failures\n\n${report.validation.errors.map((error) => `- ${error}`).join("\n")}\n`
      : "");
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const { browser, recipe } = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const url = clodUrl({
    scene: "infinite-islands",
    hud: true,
    extra: {
      acceptance: "1",
      liveClodGpuMesher: "1",
      liveClodRootMaxLevel: "1",
      liveClodGpuHierarchy: "1",
      liveClodGpuResidentRender: "1",
      liveClodGpuResidentMaxLevel: "0",
      liveClodGpuReadbackMinLevel: "1",
      liveClodGpuWeld: "1",
      liveClodGpuSimplify: "1",
      liveClodGpuMeshlets: "1",
      liveClodRootBoundsGuard: "1",
      x: "4096",
      z: "4096",
    },
  });
  const startedAt = performance.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    await page.waitForFunction(
      () => Boolean((window as typeof window & { __drusnielClod?: unknown }).__drusnielClod),
      undefined,
      { timeout: options.timeoutMs },
    );
    const counters = await waitForResidentRuntime(page, options.timeoutMs);
    const adapter = await readAdapter(page);
    const errors = validate(adapter, counters);
    const report: EvidenceReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceCommit: process.env["GITHUB_SHA"] ?? "unknown",
      url,
      elapsedMs: performance.now() - startedAt,
      adapter,
      launch: { headless: recipe.headless, channel: recipe.channel, cdpUrl: recipe.cdpUrl },
      counters,
      validation: { ok: errors.length === 0, errors },
    };
    mkdirSync(dirname(options.jsonOut), { recursive: true });
    mkdirSync(dirname(options.markdownOut), { recursive: true });
    writeFileSync(options.jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(options.markdownOut, renderMarkdown(report), "utf8");
    console.log(`[gpu-clod-resident] wrote ${options.jsonOut}`);
    console.log(`[gpu-clod-resident] wrote ${options.markdownOut}`);
    if (!report.validation.ok) throw new Error(report.validation.errors.join("; "));
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("[gpu-clod-resident] FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
