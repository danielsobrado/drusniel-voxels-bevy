import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";

interface LaunchRecipe {
  headless: boolean;
  channel?: string;
  args: string[];
}

const CANDIDATES: LaunchRecipe[] = [
  { headless: true, channel: "chromium", args: [] },
  { headless: true, channel: "chromium", args: ["--enable-unsafe-webgpu"] },
  { headless: false, args: [] },
];

const CACHE_PATH = ".cache/webgpu-flags.json";

export function clodBaseUrl(): string {
  return process.env["CLOD_POC_BASE_URL"] ?? "http://localhost:5173/";
}

async function probeRecipe(recipe: LaunchRecipe, baseUrl: string): Promise<Browser | null> {
  let browser: Browser | null = null;
  try {
    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: recipe.headless,
      args: recipe.args,
    };
    if (recipe.channel) launchOptions.channel = recipe.channel;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage();
    await page.goto(new URL("__webgpu_probe__", baseUrl).toString(), { waitUntil: "domcontentloaded" });
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

export async function launchWebGPU(): Promise<{ browser: Browser; recipe: LaunchRecipe }> {
  const baseUrl = clodBaseUrl();
  if (existsSync(CACHE_PATH)) {
    try {
      const recipe = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as LaunchRecipe;
      const browser = await probeRecipe(recipe, baseUrl);
      if (browser) return { browser, recipe };
    } catch {
      /* stale cache is harmless; probe candidates below */
    }
  }

  for (const recipe of CANDIDATES) {
    const browser = await probeRecipe(recipe, baseUrl);
    if (!browser) continue;
    mkdirSync(".cache", { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(recipe, null, 2));
    console.log(`[launch] WebGPU OK headless=${recipe.headless} channel=${recipe.channel ?? "default"} args=[${recipe.args.join(" ")}]`);
    return { browser, recipe };
  }

  throw new Error(`No Chromium launch recipe produced a WebGPU adapter. Is Vite running at ${baseUrl}?`);
}

export interface ClodUrlOptions {
  scene?: string;
  seed?: number;
  cam?: string;
  hud?: boolean;
  freeze?: boolean;
  extra?: Record<string, string>;
}

export function clodUrl(options: ClodUrlOptions, baseUrl = clodBaseUrl()): string {
  const params = new URLSearchParams();
  params.set("scene", options.scene ?? "sanity");
  if (options.seed !== undefined) params.set("seed", String(options.seed));
  if (options.cam) params.set("cam", options.cam);
  if (options.hud) params.set("hud", "1");
  if (options.freeze) params.set("freeze", "1");
  for (const [key, value] of Object.entries(options.extra ?? {})) params.set(key, value);
  return `${baseUrl}?${params.toString()}`;
}
