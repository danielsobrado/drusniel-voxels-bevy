import { chromium, type Browser, type Page } from "playwright";
import { clodBaseUrl } from "../launch.js";

const SERVER_PROBE_TIMEOUT_MS = 2500;
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
    "microsoft basic render",
    "warp adapter",
  ].find((candidate) => identity.includes(candidate));
  return marker ? `software GPU marker detected: ${marker}` : null;
}

async function assertBaseUrlReachable(baseUrl: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(baseUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `CLOD-POC dev server is not reachable at ${baseUrl} (${reason}). `
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
      readonly info?: GPUAdapterInfo;
      requestAdapterInfo?: () => Promise<GPUAdapterInfo>;
    };
    const info = extended.info
      ?? await extended.requestAdapterInfo?.().catch(() => undefined);
    const device = await adapter.requestDevice();
    try {
      const lost = device.lost.then((result) => {
        throw new Error(`WebGPU device lost during probe: ${result.message || result.reason}`);
      });
      device.pushErrorScope("validation");
      const buffer = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, new Uint32Array([1, 2, 3, 4]));
      buffer.destroy();
      device.queue.submit([]);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      await Promise.race([
        lost,
        new Promise<void>((resolve) => setTimeout(resolve, stabilityMs)),
      ]);
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
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    return await probeAdapter(page, recipe);
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
      failures.push(`${recipeLabel(recipe)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    "No headed browser exposed a stable non-software WebGPU adapter. "
      + `Failures: ${failures.slice(0, 8).join(" | ")}`,
  );
}
