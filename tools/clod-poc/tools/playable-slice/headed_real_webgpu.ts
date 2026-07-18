import { chromium, type Browser, type Page } from "playwright";
import { clodBaseUrl } from "../launch.js";

const SERVER_PROBE_TIMEOUT_MS = 2500;
const BROWSER_PROBE_TIMEOUT_MS = 15_000;
const DEVICE_STABILITY_PROBE_MS = 500;

const WEBGPU_ARGS = [
  "--enable-unsafe-webgpu",
  "--ignore-gpu-blocklist",
] as const;

const WEBGPU_VULKAN_ARGS = [
  ...WEBGPU_ARGS,
  "--enable-features=Vulkan,WebGPU",
  "--disable-gpu-sandbox",
] as const;

interface HeadedLaunchRecipe {
  readonly channel?: string;
  readonly args: readonly string[];
  readonly cdpUrl?: string;
}

interface AdapterInfoLike {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
}

export interface HeadedWebGpuProbe {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly fallbackAdapter: boolean;
  readonly recipe: string;
}

export interface HeadedWebGpuLaunch {
  readonly browser: Browser;
  readonly probe: HeadedWebGpuProbe;
}

const HEADED_CANDIDATES: readonly HeadedLaunchRecipe[] = [
  { channel: "chrome", args: WEBGPU_ARGS },
  { channel: "chrome", args: WEBGPU_VULKAN_ARGS },
  { args: WEBGPU_ARGS },
  { args: WEBGPU_VULKAN_ARGS },
  { channel: "chrome", args: [] },
  { args: [] },
];

function recipeLabel(recipe: HeadedLaunchRecipe): string {
  if (recipe.cdpUrl) return `cdp=${recipe.cdpUrl}`;
  return `headed channel=${recipe.channel ?? "default"} args=[${recipe.args.join(" ") || "none"}]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(label: string, operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function softwareGpuReason(probe: Omit<HeadedWebGpuProbe, "recipe">): string | null {
  if (probe.fallbackAdapter) return "adapter reports isFallbackAdapter=true";
  const identity = [probe.vendor, probe.architecture, probe.device, probe.description]
    .join(" ")
    .trim()
    .toLowerCase();
  if (identity.length === 0) return "adapter identity is unavailable; real GPU cannot be certified";
  const marker = [
    "swiftshader",
    "llvmpipe",
    "lavapipe",
    "software rasterizer",
    "software adapter",
    "software renderer",
    "microsoft basic render",
    "warp adapter",
    "d3d12 warp",
  ].find((candidate) => identity.includes(candidate));
  if (marker) return `software GPU marker detected: ${marker}`;
  if (/\bwarp\b/.test(identity)) return "software GPU marker detected: warp";
  return null;
}

async function assertBaseUrlReachable(baseUrl: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(baseUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `CLOD-POC dev server is not reachable at ${baseUrl} (${errorMessage(error)}). `
        + "Start it with `npm run dev` from tools/clod-poc, or set CLOD_POC_BASE_URL.",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function probeAdapter(page: Page, recipe: HeadedLaunchRecipe): Promise<HeadedWebGpuProbe> {
  const identity = await page.evaluate(async ({ stabilityMs }) => {
    const gpu = (navigator as Navigator & {
      gpu?: { requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null> };
    }).gpu;
    if (!gpu) throw new Error("navigator.gpu is missing");
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("requestAdapter() returned null");
    const extended = adapter as GPUAdapter & {
      readonly isFallbackAdapter?: boolean;
      readonly info?: AdapterInfoLike;
      requestAdapterInfo?: () => Promise<AdapterInfoLike>;
    };
    const info = extended.info
      ?? await extended.requestAdapterInfo?.().catch(() => undefined);
    const device = await adapter.requestDevice();
    try {
      const lost = device.lost.then((result) => ({
        lost: true as const,
        reason: result.message || String(result.reason),
      }));
      device.pushErrorScope("validation");
      const buffer = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      const module = device.createShaderModule({
        code: `
          @group(0) @binding(0) var<storage, read_write> values: array<u32>;
          @compute @workgroup_size(1)
          fn main() {
            values[0] = values[0] + 1u;
          }
        `,
      });
      const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "main" },
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer } }],
      });
      device.queue.writeBuffer(buffer, 0, new Uint32Array([1, 2, 3, 4]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      buffer.destroy();

      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      const stability = await Promise.race([
        lost,
        new Promise<{ lost: false }>((resolve) => setTimeout(() => resolve({ lost: false }), stabilityMs)),
      ]);
      if (stability.lost) throw new Error(`WebGPU device lost during probe: ${stability.reason}`);
    } finally {
      device.destroy();
    }
    return {
      vendor: info?.vendor ?? "",
      architecture: info?.architecture ?? "",
      device: info?.device ?? "",
      description: info?.description ?? "",
      fallbackAdapter: extended.isFallbackAdapter === true,
    };
  }, { stabilityMs: DEVICE_STABILITY_PROBE_MS });

  const probe: HeadedWebGpuProbe = { ...identity, recipe: recipeLabel(recipe) };
  const softwareReason = softwareGpuReason(probe);
  if (softwareReason) throw new Error(softwareReason);
  return probe;
}

async function probeBrowser(browser: Browser, recipe: HeadedLaunchRecipe, baseUrl: string): Promise<HeadedWebGpuProbe> {
  const page = await browser.newPage();
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("webgpuProbe", "1");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: BROWSER_PROBE_TIMEOUT_MS });
    return await withTimeout("WebGPU adapter probe", probeAdapter(page, recipe), BROWSER_PROBE_TIMEOUT_MS);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function launchRecipe(recipe: HeadedLaunchRecipe, baseUrl: string): Promise<HeadedWebGpuLaunch> {
  const browser = recipe.cdpUrl
    ? await chromium.connectOverCDP(recipe.cdpUrl)
    : await chromium.launch({
        headless: false,
        ...(recipe.channel ? { channel: recipe.channel } : {}),
        args: [...recipe.args],
      });
  try {
    const probe = await probeBrowser(browser, recipe, baseUrl);
    return { browser, probe };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

export async function launchHeadedRealWebGPU(): Promise<HeadedWebGpuLaunch> {
  const baseUrl = clodBaseUrl();
  await assertBaseUrlReachable(baseUrl);
  const cdpUrl = process.env["CLOD_POC_CDP_URL"];
  if (cdpUrl) return launchRecipe({ args: [], cdpUrl }, baseUrl);

  const forcedChannel = process.env["CLOD_POC_BROWSER_CHANNEL"];
  const candidates = forcedChannel
    ? HEADED_CANDIDATES.map((recipe) => ({ ...recipe, channel: forcedChannel }))
    : HEADED_CANDIDATES;
  const failures: string[] = [];
  for (const recipe of candidates) {
    try {
      const launched = await launchRecipe(recipe, baseUrl);
      console.log(`[playable-slice:launch] real WebGPU OK ${launched.probe.recipe}`);
      return launched;
    } catch (error) {
      failures.push(`${recipeLabel(recipe)}: ${errorMessage(error)}`);
    }
  }
  throw new Error(
    "No headed browser exposed a stable non-software WebGPU adapter. "
      + `Failures: ${failures.slice(0, 8).join(" | ")}`,
  );
}
