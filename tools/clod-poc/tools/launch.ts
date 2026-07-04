import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";

interface LaunchRecipe {
  headless: boolean;
  channel?: string;
  args: string[];
  cdpUrl?: string;
}

interface ProbeResult {
  browser: Browser | null;
  failure: string | null;
}

const WEBGPU_ARGS = [
  "--enable-unsafe-webgpu",
  "--ignore-gpu-blocklist",
] as const;

const WEBGPU_VULKAN_ARGS = [
  ...WEBGPU_ARGS,
  "--enable-features=Vulkan,WebGPU",
  "--disable-gpu-sandbox",
] as const;

const WEBGPU_SWIFTSHADER_ARGS = [
  ...WEBGPU_VULKAN_ARGS,
  "--use-vulkan=swiftshader",
  "--disable-vulkan-surface",
] as const;

const CANDIDATES: LaunchRecipe[] = [
  { headless: true, channel: "chromium", args: [] },
  { headless: true, channel: "chromium", args: [...WEBGPU_ARGS] },
  { headless: true, channel: "chromium", args: [...WEBGPU_VULKAN_ARGS] },
  { headless: true, channel: "chromium", args: [...WEBGPU_SWIFTSHADER_ARGS] },
  { headless: true, channel: "chrome", args: [...WEBGPU_ARGS] },
  { headless: true, channel: "chrome", args: [...WEBGPU_VULKAN_ARGS] },
  { headless: false, channel: "chrome", args: [...WEBGPU_ARGS] },
  { headless: false, args: [...WEBGPU_ARGS] },
  { headless: false, args: [] },
];

const GENERIC_CANDIDATES: LaunchRecipe[] = [
  { headless: true, channel: "chromium", args: [] },
  { headless: true, args: [] },
  { headless: false, args: [] },
];

const CACHE_PATH = ".cache/webgpu-flags.json";
const SERVER_PROBE_TIMEOUT_MS = 2500;
const INFINITE_ISLANDS_SCENE = "infinite-islands";
const INFINITE_ISLANDS_DEFAULT_CAM_Y = 96;
const INFINITE_ISLANDS_DEFAULT_PITCH = -0.43;
const INFINITE_ISLANDS_DEFAULT_FOV = 55;

export function clodBaseUrl(): string {
  return process.env["CLOD_POC_BASE_URL"] ?? "http://localhost:5173/";
}

function recipeLabel(recipe: LaunchRecipe): string {
  const channel = recipe.channel ?? "default";
  const args = recipe.args.length > 0 ? recipe.args.join(" ") : "none";
  return `headless=${recipe.headless} channel=${channel} args=[${args}]`;
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
      `CLOD-POC dev server is not reachable at ${baseUrl} (${reason}). ` +
        "Start it with `npm run dev` from tools/clod-poc, or pass `--baseUrl` / CLOD_POC_BASE_URL.",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function tryLaunch(recipe: LaunchRecipe): Promise<Browser | null> {
  try {
    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: recipe.headless,
      args: recipe.args,
    };
    if (recipe.channel) launchOptions.channel = recipe.channel;
    return await chromium.launch(launchOptions);
  } catch {
    return null;
  }
}

async function probeRecipe(recipe: LaunchRecipe, baseUrl: string): Promise<ProbeResult> {
  let browser: Browser | null = null;
  try {
    browser = await tryLaunch(recipe);
    if (!browser) return { browser: null, failure: `${recipeLabel(recipe)}: browser launch failed` };
    const page = await browser.newPage();
    const probeUrl = new URL(baseUrl);
    probeUrl.searchParams.set("webgpuProbe", "1");
    await page.goto(probeUrl.toString(), { waitUntil: "domcontentloaded" });
    const probe = await page.evaluate(async () => {
      const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (!gpu) return { ok: false, reason: "navigator.gpu is missing" };
      const adapter = await gpu.requestAdapter();
      return adapter ? { ok: true, reason: "adapter available" } : { ok: false, reason: "requestAdapter() returned null" };
    });
    await page.close();
    if (probe.ok) return { browser, failure: null };
    await browser.close();
    return { browser: null, failure: `${recipeLabel(recipe)}: ${probe.reason}` };
  } catch (error) {
    if (browser) await browser.close().catch(() => undefined);
    return {
      browser: null,
      failure: `${recipeLabel(recipe)}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function launchChromium(): Promise<{ browser: Browser; recipe: LaunchRecipe }> {
  for (const recipe of GENERIC_CANDIDATES) {
    const browser = await tryLaunch(recipe);
    if (!browser) continue;
    console.log(`[launch] Chromium OK ${recipeLabel(recipe)}`);
    return { browser, recipe };
  }
  throw new Error("No Chromium launch recipe succeeded. Run `npx playwright install chromium` if this is a fresh machine.");
}

export async function launchWebGPU(): Promise<{ browser: Browser; recipe: LaunchRecipe }> {
  const baseUrl = clodBaseUrl();
  await assertBaseUrlReachable(baseUrl);

  const forcedChannel = process.env["CLOD_POC_BROWSER_CHANNEL"];
  const cdpUrl = process.env["CLOD_POC_CDP_URL"];
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const page = await browser.newPage();
    try {
      const probeUrl = new URL(baseUrl);
      probeUrl.searchParams.set("webgpuProbe", "1");
      await page.goto(probeUrl.toString(), { waitUntil: "domcontentloaded" });
      const ok = await page.evaluate(async () => {
        const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        if (!gpu) return false;
        return (await gpu.requestAdapter()) !== null;
      });
      if (!ok) throw new Error(`Chrome at ${cdpUrl} did not expose a WebGPU adapter`);
      console.log(`[launch] WebGPU OK cdp=${cdpUrl}`);
      return { browser, recipe: { headless: false, args: [], cdpUrl } };
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  if (!forcedChannel && existsSync(CACHE_PATH)) {
    try {
      const recipe = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as LaunchRecipe;
      const result = await probeRecipe(recipe, baseUrl);
      if (result.browser) return { browser: result.browser, recipe };
    } catch {
      /* stale cache is harmless; probe candidates below */
    }
  }

  const candidates = forcedChannel
    ? [
      { headless: true, channel: forcedChannel, args: [...WEBGPU_ARGS] },
      { headless: true, channel: forcedChannel, args: [...WEBGPU_VULKAN_ARGS] },
      { headless: true, channel: forcedChannel, args: [...WEBGPU_SWIFTSHADER_ARGS] },
      { headless: false, channel: forcedChannel, args: [...WEBGPU_ARGS] },
      { headless: true, channel: forcedChannel, args: [] },
      { headless: false, channel: forcedChannel, args: [] },
    ]
    : CANDIDATES;

  const failures: string[] = [];
  for (const recipe of candidates) {
    const result = await probeRecipe(recipe, baseUrl);
    if (!result.browser) {
      if (result.failure) failures.push(result.failure);
      continue;
    }
    if (!forcedChannel) {
      mkdirSync(".cache", { recursive: true });
      writeFileSync(CACHE_PATH, JSON.stringify(recipe, null, 2));
    }
    console.log(`[launch] WebGPU OK ${recipeLabel(recipe)}`);
    return { browser: result.browser, recipe };
  }

  throw new Error(
    `No Chromium launch recipe produced a WebGPU adapter at ${baseUrl}. ` +
      "Try a desktop Chrome session with `CLOD_POC_CDP_URL`, or set `--renderer webgl` for non-WebGPU smoke data. " +
      `Probe failures: ${failures.slice(0, 8).join(" | ")}`,
  );
}

export interface ClodUrlOptions {
  scene?: string | null;
  seed?: number;
  cam?: string;
  hud?: boolean;
  freeze?: boolean;
  extra?: Record<string, string>;
}

function inferredInfiniteIslandsCamera(options: ClodUrlOptions): string | null {
  if (options.cam || options.scene !== INFINITE_ISLANDS_SCENE) return null;
  const extra = options.extra ?? {};
  const x = Number(extra["x"]);
  const z = Number(extra["z"]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const yaw = Number(extra["yaw"]);
  const safeYaw = Number.isFinite(yaw) ? yaw : 2.65;
  return `${x},${INFINITE_ISLANDS_DEFAULT_CAM_Y},${z},${safeYaw.toFixed(4)},${INFINITE_ISLANDS_DEFAULT_PITCH.toFixed(4)},${INFINITE_ISLANDS_DEFAULT_FOV}`;
}

export function clodUrl(options: ClodUrlOptions, baseUrl = clodBaseUrl()): string {
  const params = new URLSearchParams();
  if (options.scene !== null) params.set("scene", options.scene ?? "sanity");
  if (options.seed !== undefined) params.set("seed", String(options.seed));
  const cam = options.cam ?? inferredInfiniteIslandsCamera(options);
  if (cam) params.set("cam", cam);
  if (options.hud) params.set("hud", "1");
  if (options.freeze) params.set("freeze", "1");
  for (const [key, value] of Object.entries(options.extra ?? {})) params.set(key, value);
  return `${baseUrl}?${params.toString()}`;
}
