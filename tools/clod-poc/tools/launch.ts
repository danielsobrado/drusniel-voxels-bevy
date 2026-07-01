import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";

interface LaunchRecipe {
  headless: boolean;
  channel?: string;
  args: string[];
  cdpUrl?: string;
}

const CANDIDATES: LaunchRecipe[] = [
  { headless: true, channel: "chromium", args: [] },
  { headless: true, channel: "chromium", args: ["--enable-unsafe-webgpu"] },
  { headless: true, channel: "chrome", args: ["--enable-unsafe-webgpu"] },
  { headless: false, channel: "chrome", args: ["--enable-unsafe-webgpu"] },
  { headless: false, args: ["--enable-unsafe-webgpu"] },
  { headless: false, args: [] },
];

const GENERIC_CANDIDATES: LaunchRecipe[] = [
  { headless: true, channel: "chromium", args: [] },
  { headless: true, args: [] },
  { headless: false, args: [] },
];

const CACHE_PATH = ".cache/webgpu-flags.json";

export function clodBaseUrl(): string {
  return process.env["CLOD_POC_BASE_URL"] ?? "http://localhost:5173/";
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

async function probeRecipe(recipe: LaunchRecipe, baseUrl: string): Promise<Browser | null> {
  let browser: Browser | null = null;
  try {
    browser = await tryLaunch(recipe);
    if (!browser) return null;
    const page = await browser.newPage();
    const probeUrl = new URL(baseUrl);
    probeUrl.searchParams.set("webgpuProbe", "1");
    await page.goto(probeUrl.toString(), { waitUntil: "domcontentloaded" });
    const ok = await page.evaluate(async () => {
      const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (!gpu) return false;
      return (await gpu.requestAdapter()) !== null;
    });
    await page.close();
    if (ok) return browser;
    await browser.close();
    return null;
  } catch {
    if (browser) await browser.close().catch(() => undefined);
    return null;
  }
}

export async function launchChromium(): Promise<{ browser: Browser; recipe: LaunchRecipe }> {
  for (const recipe of GENERIC_CANDIDATES) {
    const browser = await tryLaunch(recipe);
    if (!browser) continue;
    console.log(`[launch] Chromium OK headless=${recipe.headless} channel=${recipe.channel ?? "default"} args=[${recipe.args.join(" ")}]`);
    return { browser, recipe };
  }
  throw new Error("No Chromium launch recipe succeeded. Run `npx playwright install chromium` if this is a fresh machine.");
}

export async function launchWebGPU(): Promise<{ browser: Browser; recipe: LaunchRecipe }> {
  const baseUrl = clodBaseUrl();
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
      const browser = await probeRecipe(recipe, baseUrl);
      if (browser) return { browser, recipe };
    } catch {
      /* stale cache is harmless; probe candidates below */
    }
  }

  const candidates = forcedChannel
    ? [
      { headless: true, channel: forcedChannel, args: ["--enable-unsafe-webgpu"] },
      { headless: false, channel: forcedChannel, args: ["--enable-unsafe-webgpu"] },
      { headless: true, channel: forcedChannel, args: [] },
      { headless: false, channel: forcedChannel, args: [] },
    ]
    : CANDIDATES;

  for (const recipe of candidates) {
    const browser = await probeRecipe(recipe, baseUrl);
    if (!browser) continue;
    if (!forcedChannel) {
      mkdirSync(".cache", { recursive: true });
      writeFileSync(CACHE_PATH, JSON.stringify(recipe, null, 2));
    }
    console.log(`[launch] WebGPU OK headless=${recipe.headless} channel=${recipe.channel ?? "default"} args=[${recipe.args.join(" ")}]`);
    return { browser, recipe };
  }

  throw new Error(`No Chromium launch recipe produced a WebGPU adapter. Is Vite running at ${baseUrl}?`);
}

export interface ClodUrlOptions {
  scene?: string | null;
  seed?: number;
  cam?: string;
  hud?: boolean;
  freeze?: boolean;
  extra?: Record<string, string>;
}

export function clodUrl(options: ClodUrlOptions, baseUrl = clodBaseUrl()): string {
  const params = new URLSearchParams();
  if (options.scene !== null) params.set("scene", options.scene ?? "sanity");
  if (options.seed !== undefined) params.set("seed", String(options.seed));
  if (options.cam) params.set("cam", options.cam);
  if (options.hud) params.set("hud", "1");
  if (options.freeze) params.set("freeze", "1");
  for (const [key, value] of Object.entries(options.extra ?? {})) params.set(key, value);
  return `${baseUrl}?${params.toString()}`;
}
