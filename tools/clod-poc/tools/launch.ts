import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

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

interface WebGpuProbeResult {
  ok: boolean;
  reason: string;
}

interface AcceptanceConvergenceSnapshot {
  acceptance: boolean;
  label: string;
  tilesMissing: number;
  tilesBuilding: number;
  farShellRebuildPending: number;
  textureWindowPending: number;
  bubbleBuilding: number;
  bubbleReady: number;
  bubbleRequired: number;
  bubbleFailed: number;
  bubbleRetryPages: number;
  bubbleColliderPages: number;
  streamRequired: number;
  streamBudget: number;
  streamPending: number;
  streamInflight: number;
  streamReady: number;
  streamCached: number;
  streamFailed: number;
  streamMaxCached: number;
  streamSafetyCacheCapacityOk: number;
  streamSafetyRequired: number;
  streamSafetyReady: number;
  streamSafetyPending: number;
  streamSafetyInflight: number;
  streamRefinementPending: number;
  streamRefinementInflight: number;
  streamParentCoverageViolations: number;
  streamActiveRootPages: number;
  proxyBuilding: number;
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
const GPU_DEVICE_LOST_PROBE_MS = 500;
const INFINITE_ISLANDS_SCENE = "infinite-islands";
const INFINITE_ISLANDS_DEFAULT_CAM_Y = 96;
const INFINITE_ISLANDS_DEFAULT_PITCH = -0.43;
const INFINITE_ISLANDS_DEFAULT_FOV = 55;
const ACCEPTANCE_CONVERGENCE_LOG_INTERVAL_MS = 5000;

const convergenceLoggerBrowsers = new WeakSet<Browser>();

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

async function runWebGpuDeviceProbe(page: Awaited<ReturnType<Browser["newPage"]>>): Promise<WebGpuProbeResult> {
  return await page.evaluate(async ({ lostTimeoutMs }) => {
    const gpu = (navigator as Navigator & {
      gpu?: {
        requestAdapter(): Promise<GPUAdapter | null>;
      };
    }).gpu;
    if (!gpu) return { ok: false, reason: "navigator.gpu is missing" };
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: "requestAdapter() returned null" };

    let device: GPUDevice | null = null;
    try {
      device = await adapter.requestDevice();
      const lost = device.lost.then((info) => ({ lost: true, reason: info.message || info.reason || "device lost" }));
      const stable = new Promise<{ lost: false }>((resolve) => setTimeout(() => resolve({ lost: false }), lostTimeoutMs));

      device.pushErrorScope("validation");
      const mapped = device.createBuffer({ size: 120, usage: GPUBufferUsage.MAP_WRITE, mappedAtCreation: true });
      new Uint32Array(mapped.getMappedRange()).fill(0);
      mapped.unmap();
      mapped.destroy();

      const storage = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(storage, 0, new Uint32Array([1, 2, 3, 4]));
      storage.destroy();
      device.queue.submit([]);

      const validationError = await device.popErrorScope();
      if (validationError) return { ok: false, reason: validationError.message };
      const lostResult = await Promise.race([lost, stable]);
      if (lostResult.lost) return { ok: false, reason: lostResult.reason };
      return { ok: true, reason: "device stable" };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    } finally {
      device?.destroy();
    }
  }, { lostTimeoutMs: GPU_DEVICE_LOST_PROBE_MS });
}

function convergenceBlockers(snapshot: AcceptanceConvergenceSnapshot): string[] {
  const blockers: string[] = [];
  const farSummaryQuiet = snapshot.tilesMissing === 0 && snapshot.tilesBuilding === 0;
  const shellQuiet = snapshot.farShellRebuildPending === 0;
  const textureQuiet = snapshot.textureWindowPending === 0;
  const bubbleQuiet = snapshot.bubbleRequired === 0 || (
    snapshot.bubbleFailed === 0
    && snapshot.bubbleRetryPages === 0
    && snapshot.bubbleBuilding === 0
    && snapshot.bubbleReady > 0
  );
  const streamQuiet = snapshot.streamRequired === 0 || (
    snapshot.streamFailed === 0
    && snapshot.streamSafetyCacheCapacityOk !== 0
    && snapshot.streamSafetyPending === 0
    && snapshot.streamSafetyInflight === 0
    && snapshot.streamParentCoverageViolations === 0
    && snapshot.streamActiveRootPages > 0
  );
  const proxyQuiet = snapshot.proxyBuilding !== 1;

  if (!farSummaryQuiet) blockers.push(`farSummary missing=${snapshot.tilesMissing} building=${snapshot.tilesBuilding}`);
  if (!shellQuiet) blockers.push(`farShell pending=${snapshot.farShellRebuildPending}`);
  if (!textureQuiet) blockers.push(`textureWindow pending=${snapshot.textureWindowPending}`);
  if (!bubbleQuiet) {
    blockers.push(
      `liveBubble required=${snapshot.bubbleRequired} ready=${snapshot.bubbleReady} ` +
      `building=${snapshot.bubbleBuilding} failed=${snapshot.bubbleFailed} ` +
      `retry=${snapshot.bubbleRetryPages} colliders=${snapshot.bubbleColliderPages}`,
    );
  }
  if (!streamQuiet) {
    blockers.push(
      `liveClodStream required=${snapshot.streamRequired} budget=${snapshot.streamBudget} ` +
      `pending=${snapshot.streamPending} inflight=${snapshot.streamInflight} ` +
      `safetyCacheCapacityOk=${snapshot.streamSafetyCacheCapacityOk} safetyRequired=${snapshot.streamSafetyRequired} ` +
      `maxCached=${snapshot.streamMaxCached} ` +
      `safetyPending=${snapshot.streamSafetyPending} safetyInflight=${snapshot.streamSafetyInflight} ` +
      `refinementPending=${snapshot.streamRefinementPending} refinementInflight=${snapshot.streamRefinementInflight} ` +
      `parentCoverageViolations=${snapshot.streamParentCoverageViolations} activeRoots=${snapshot.streamActiveRootPages} ` +
      `ready=${snapshot.streamReady} cached=${snapshot.streamCached} failed=${snapshot.streamFailed}`,
    );
  }
  if (!proxyQuiet) blockers.push(`shadowProxy building=${snapshot.proxyBuilding}`);
  return blockers;
}

async function readAcceptanceConvergenceSnapshot(page: Page): Promise<AcceptanceConvergenceSnapshot | null> {
  return await page.evaluate(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("acceptance") !== "1") return null;
    const counters = (window as typeof window & {
      __drusnielClod?: { stats?: { counters?: Record<string, number> } | null };
    }).__drusnielClod?.stats?.counters ?? {};
    const gate = params.get("ownershipOracle") === "1" ? "coverage" : "perf";
    const scene = params.get("scene") ?? "unknown";
    const debug = params.get("proceduralDebug");
    const freeze = params.get("freeze") === "1" ? "freeze" : "live";
    return {
      acceptance: true,
      label: `${gate}/${scene}/${debug ?? "final"}/${freeze}`,
      tilesMissing: counters["far_summary_tiles_missing"] ?? -1,
      tilesBuilding: counters["far_summary_tiles_building"] ?? -1,
      farShellRebuildPending: counters["far_shell_rebuild_pending"] ?? 0,
      textureWindowPending: counters["terrain_texture_window_pending"] ?? 0,
      bubbleBuilding: counters["live_bubble_building_pages"] ?? -1,
      bubbleReady: counters["live_bubble_ready_pages"] ?? -1,
      bubbleRequired: counters["live_bubble_required_pages"] ?? -1,
      bubbleFailed: counters["live_bubble_failed_pages"] ?? -1,
      bubbleRetryPages: counters["live_bubble_gpu_retry_pages"] ?? 0,
      bubbleColliderPages: counters["live_bubble_streamed_collider_pages"] ?? -1,
      streamRequired: counters["live_clod_stream_required_pages"] ?? 0,
      streamBudget: counters["live_clod_stream_build_budget"] ?? 0,
      streamPending: counters["live_clod_stream_pending_pages"] ?? 0,
      streamInflight: counters["live_clod_stream_inflight_batches"] ?? 0,
      streamReady: counters["live_clod_stream_ready_pages"] ?? 0,
      streamCached: counters["live_clod_stream_cached_pages"] ?? 0,
      streamFailed: counters["live_clod_stream_failed_pages"] ?? 0,
      streamMaxCached: counters["live_clod_stream_max_cached_pages"] ?? 0,
      streamSafetyCacheCapacityOk: counters["live_clod_stream_safety_cache_capacity_ok"] ?? 1,
      streamSafetyRequired: counters["live_clod_stream_safety_required_pages"] ?? 0,
      streamSafetyReady: counters["live_clod_stream_safety_ready_pages"] ?? 0,
      streamSafetyPending: counters["live_clod_stream_safety_pending_pages"] ?? 0,
      streamSafetyInflight: counters["live_clod_stream_safety_inflight_pages"] ?? 0,
      streamRefinementPending: counters["live_clod_stream_refinement_pending_pages"] ?? 0,
      streamRefinementInflight: counters["live_clod_stream_refinement_inflight_pages"] ?? 0,
      streamParentCoverageViolations: counters["live_clod_stream_parent_coverage_violations"] ?? 0,
      streamActiveRootPages: counters["live_clod_stream_active_root_pages"] ?? 0,
      proxyBuilding: counters["shadow_proxy_building"] ?? -1,
    } satisfies AcceptanceConvergenceSnapshot;
  });
}

function attachAcceptanceConvergenceLogger(page: Page): void {
  const startedAt = Date.now();
  let lastMessage = "";
  const timer = setInterval(() => {
    if (page.isClosed()) {
      clearInterval(timer);
      return;
    }
    void readAcceptanceConvergenceSnapshot(page).then((snapshot) => {
      if (!snapshot?.acceptance) return;
      const blockers = convergenceBlockers(snapshot);
      if (blockers.length === 0) return;
      const message = `${snapshot.label}: ${blockers.join("; ")}`;
      if (message === lastMessage) return;
      lastMessage = message;
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[infinite-accept:convergence] ${elapsed}s ${message}`);
    }).catch(() => undefined);
  }, ACCEPTANCE_CONVERGENCE_LOG_INTERVAL_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
  page.once("close", () => clearInterval(timer));
}

function installAcceptanceConvergenceLogger(browser: Browser): Browser {
  if (convergenceLoggerBrowsers.has(browser)) return browser;
  convergenceLoggerBrowsers.add(browser);
  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = (async (...args: Parameters<Browser["newPage"]>) => {
    const page = await originalNewPage(...args);
    attachAcceptanceConvergenceLogger(page);
    return page;
  }) as Browser["newPage"];
  return browser;
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
    const probe = await runWebGpuDeviceProbe(page);
    await page.close();
    if (probe.ok) return { browser: installAcceptanceConvergenceLogger(browser), failure: null };
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
      const probe = await runWebGpuDeviceProbe(page);
      if (!probe.ok) throw new Error(`Chrome at ${cdpUrl} did not expose a stable WebGPU device: ${probe.reason}`);
      console.log(`[launch] WebGPU OK cdp=${cdpUrl}`);
      return { browser: installAcceptanceConvergenceLogger(browser), recipe: { headless: false, args: [], cdpUrl } };
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
    `No Chromium launch recipe produced a stable WebGPU device at ${baseUrl}. ` +
      "For WSL/headless failures, run a native desktop Chrome session and pass CLOD_POC_CDP_URL. " +
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
