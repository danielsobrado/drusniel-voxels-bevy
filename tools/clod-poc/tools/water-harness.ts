import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import net from "node:net";
import { Readable, Writable } from "node:stream";

export interface WaterProbe {
  terrain: number;
  water: number;
  depth: number;
  flowX: number;
  flowZ: number;
  flowSpeed: number;
  flowProgress: number;
  flowDrop: number;
  bodyMask: number;
}

export interface WaterDebugInfo {
  worldCells: number;
  enabled: boolean;
  debugMode: string;
  clipmapTint: boolean;
  wireframe: boolean;
  debugModes: Record<string, number>;
  clipmap: {
    levelCount: number;
    levels: Array<{ minX: number; minZ: number; maxX: number; maxZ: number } | null>;
  };
  fakeBodies: {
    lakes: Array<{ center: [number, number]; radius: [number, number]; levelOffset: number }>;
    rivers: Array<{ points: Array<[number, number]>; width: number; levelOffset: number; downstreamDrop: number }>;
  };
}

export interface CameraPoseArgs {
  x: number;
  z: number;
  yaw?: number;
  y?: number;
  distance?: number;
  pitch?: number;
}

export interface HarnessOptions {
  url?: string;
  port?: number;
  world?: number;
  width?: number;
  height?: number;
  headless?: boolean;
}

interface CdpResponse {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string; data?: string };
}

interface RuntimeEvaluateResult {
  result: {
    type: string;
    value?: unknown;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
  };
}

interface LaunchedProcess {
  child: ChildProcess;
  windowsTree: boolean;
}

export class CdpPage {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private pipeBuffer = "";
  private sessionId: string | null = null;

  private constructor(
    private readonly writeRaw: (message: string) => void,
    private readonly closeRaw: () => void,
  ) {}

  static connect(url: string): Promise<CdpPage> {
    return new Promise((resolveConnect, rejectConnect) => {
      const ws = new WebSocket(url);
      const page = new CdpPage((message) => ws.send(message), () => ws.close());
      ws.addEventListener("open", () => resolveConnect(page), { once: true });
      ws.addEventListener("error", () => rejectConnect(new Error(`failed to connect to CDP websocket: ${url}`)), { once: true });
      ws.addEventListener("message", (event) => page.onMessage(event.data));
      ws.addEventListener("close", () => {
        for (const pending of page.pending.values()) pending.reject(new Error("CDP websocket closed"));
        page.pending.clear();
      });
    });
  }

  static connectPipe(browser: ChildProcess): CdpPage {
    const write = browser.stdio[3] as Writable | null;
    const read = browser.stdio[4] as Readable | null;
    if (!write || !read) throw new Error("Chrome remote debugging pipe was not opened");
    const page = new CdpPage(
      (message) => {
        if (!write.write(`${message}\0`)) {
          // Backpressure is not expected for the small command stream used here.
        }
      },
      () => {
        write.end();
        read.destroy();
      },
    );
    read.setEncoding("utf8");
    read.on("data", (chunk: string) => page.onPipeData(chunk));
    read.on("error", (error) => {
      for (const pending of page.pending.values()) pending.reject(error);
      page.pending.clear();
    });
    read.on("close", () => {
      for (const pending of page.pending.values()) pending.reject(new Error("CDP pipe closed"));
      page.pending.clear();
    });
    return page;
  }

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const payload = {
      id,
      method,
      ...(params === undefined ? {} : { params }),
      ...(this.sessionId === null ? {} : { sessionId: this.sessionId }),
    };
    const result = new Promise<T>((resolveSend, rejectSend) => {
      this.pending.set(id, {
        resolve: (value) => resolveSend(value as T),
        reject: rejectSend,
      });
    });
    this.writeRaw(JSON.stringify(payload));
    return result;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<RuntimeEvaluateResult>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "browser evaluation failed");
    }
    return result.result.value as T;
  }

  async screenshot(path: string): Promise<void> {
    const result = await this.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    writeFileSync(path, Buffer.from(result.data, "base64"));
  }

  close(): void {
    this.closeRaw();
  }

  private onMessage(data: unknown): void {
    const text = typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8");
    const message = JSON.parse(text) as CdpResponse;
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.data ? `${message.error.message}: ${message.error.data}` : message.error.message));
    else pending.resolve(message.result);
  }

  private onPipeData(chunk: string): void {
    this.pipeBuffer += chunk;
    for (;;) {
      const boundary = this.pipeBuffer.indexOf("\0");
      if (boundary < 0) break;
      const message = this.pipeBuffer.slice(0, boundary);
      this.pipeBuffer = this.pipeBuffer.slice(boundary + 1);
      if (message) this.onMessage(message);
    }
  }
}

export interface WaterHarness {
  page: CdpPage;
  url: string;
}

interface RunningHarness extends WaterHarness {
  close: () => Promise<void>;
}

export async function withWaterHarness<T>(options: HarnessOptions, run: (harness: WaterHarness) => Promise<T>): Promise<T> {
  const harness = await startWaterHarness(options);
  try {
    return await run(harness);
  } finally {
    await harness.close();
  }
}

export async function waterDebugInfo(page: CdpPage): Promise<WaterDebugInfo> {
  return page.evaluate<WaterDebugInfo>("window.waterDebugInfo()");
}

export async function setCameraPose(page: CdpPage, pose: CameraPoseArgs): Promise<void> {
  await page.evaluate(`window.setCameraPose(${JSON.stringify(pose)})`);
  await settleFrames(page, 8);
}

export async function setWaterDebugMode(page: CdpPage, mode: string): Promise<void> {
  await page.evaluate(`window.setWaterDebugMode(${JSON.stringify(mode)})`);
  await settleFrames(page, 4);
}

export async function settleFrames(page: CdpPage, frames: number): Promise<void> {
  await page.evaluate(`new Promise((resolve) => {
    let remaining = ${Math.max(1, Math.floor(frames))};
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) resolve(true);
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  })`);
}

export async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 50; port++) {
    if (await canListen(port)) return port;
  }
  throw new Error(`could not find a free port starting at ${start}`);
}

export function numberArg(args: Record<string, string | boolean>, name: string, fallback: number): number {
  const raw = args[name];
  if (typeof raw !== "string") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number`);
  return value;
}

export function stringArg(args: Record<string, string | boolean>, name: string, fallback: string): string {
  const raw = args[name];
  return typeof raw === "string" && raw.length > 0 ? raw : fallback;
}

export function booleanArg(args: Record<string, string | boolean>, name: string): boolean {
  return args[name] === true || args[name] === "1" || args[name] === "true";
}

export function parseCliArgs(argv: readonly string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    const eq = arg.indexOf("=");
    if (eq > 2) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function startWaterHarness(options: HarnessOptions): Promise<RunningHarness> {
  const width = Math.max(320, Math.floor(options.width ?? 1280));
  const height = Math.max(240, Math.floor(options.height ?? 720));
  const world = Math.max(1, Math.floor(options.world ?? 16));
  const launched: LaunchedProcess[] = [];
  let userDataDir: string | null = null;
  let page: CdpPage | null = null;
  let appUrl = options.url ? withDebugQuery(options.url, world) : "";
  const chrome = discoverBrowserExecutable();
  const chromeIsWindows = chrome.endsWith(".exe");
  if (chromeIsWindows && process.platform !== "win32") {
    throw new Error(
      "found Windows Chrome from a WSL Node process, but this harness needs a browser it can control directly; " +
        "run the water tools from a native Windows shell or set CHROME_PATH to a Linux Chrome/Chromium executable",
    );
  }

  if (!appUrl) {
    const port = options.port ?? await findFreePort(5180);
    const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", String(port), "--strictPort"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    launched.push({ child: vite, windowsTree: false });
    vite.stdout?.on("data", (chunk) => process.stderr.write(prefixLines("[vite] ", chunk)));
    vite.stderr?.on("data", (chunk) => process.stderr.write(prefixLines("[vite] ", chunk)));
    appUrl = withDebugQuery(`http://127.0.0.1:${port}/`, world);
    await waitForHttp(appUrl, 120_000);
  }

  try {
    const profile = makeBrowserProfileDir(chrome);
    userDataDir = profile.localPath;
    const chromeArgs = [
      `--user-data-dir=${profile.browserPath}`,
      "--remote-debugging-pipe",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-crash-reporter",
      "--disable-sync",
      "--disable-dev-shm-usage",
      `--window-size=${width},${height}`,
      options.headless === false ? "" : "--headless=new",
      "about:blank",
    ].filter(Boolean);
    const browser = spawn(chrome, chromeArgs, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
    browser.stderr?.on("data", (chunk) => process.stderr.write(prefixLines("[chrome] ", chunk)));
    launched.push({ child: browser, windowsTree: chromeIsWindows });
    page = CdpPage.connectPipe(browser);
    const target = await page.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const attached = await page.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    page.setSession(attached.sessionId);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.send("Page.navigate", { url: appUrl });
    await waitForWaterApi(page, 180_000);
    return {
      page,
      url: appUrl,
      close: async () => {
        page?.close();
        for (const entry of launched.reverse()) terminateProcess(entry);
        await delay(500);
        if (userDataDir) removeDirBestEffort(userDataDir);
      },
    };
  } catch (error) {
    page?.close();
    for (const entry of launched.reverse()) terminateProcess(entry);
    await delay(500);
    if (userDataDir) removeDirBestEffort(userDataDir);
    throw error;
  }
}

async function waitForWaterApi(page: CdpPage, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate<boolean>(
      "typeof window.waterProbe === 'function' && typeof window.setWaterDebugMode === 'function' && typeof window.setCameraPose === 'function' && typeof window.waterDebugInfo === 'function'",
    ).catch(() => false);
    if (ready) return;
    await delay(250);
  }
  throw new Error("timed out waiting for water debug API");
}

function withDebugQuery(input: string, world: number): string {
  const url = new URL(input);
  if (!url.searchParams.has("world")) url.searchParams.set("world", String(world));
  url.searchParams.set("waterDebug", "1");
  return url.toString();
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep polling while Vite starts
    }
    await delay(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function discoverBrowserExecutable(): string {
  const envPath = process.env.CHROME_PATH;
  const candidates = [
    envPath,
    "google-chrome",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "msedge",
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (candidate.includes("/") && existsSync(candidate)) return candidate;
    if (!candidate.includes("/")) {
      try {
        const found = execFileSync("bash", ["-lc", `command -v ${candidate}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (found) return found;
      } catch {
        // try the next candidate
      }
    }
  }
  throw new Error("could not find Chrome/Chromium/Edge; set CHROME_PATH to a browser executable");
}

function toWindowsPath(path: string): string {
  try {
    return execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim();
  } catch {
    return path;
  }
}

function makeBrowserProfileDir(browserExecutable: string): { localPath: string; browserPath: string } {
  if (!browserExecutable.endsWith(".exe")) {
    const localPath = mkdtempSync(join(tmpdir(), "clod-water-chrome-"));
    return { localPath, browserPath: localPath };
  }
  const localTemp = windowsTempAsWslPath();
  const localPath = mkdtempSync(join(localTemp, "clod-water-chrome-"));
  return { localPath, browserPath: toWindowsPath(localPath) };
}

function windowsTempAsWslPath(): string {
  try {
    const winTemp = execFileSync("cmd.exe", ["/c", "echo %TEMP%"], { encoding: "utf8" }).trim();
    const local = execFileSync("wslpath", ["-u", winTemp], { encoding: "utf8" }).trim();
    if (existsSync(local)) return local;
  } catch {
    // fall back below
  }
  return tmpdir();
}

function prefixLines(prefix: string, chunk: Buffer): string {
  return chunk.toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => `${prefix}${line}\n`).join("");
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolveCanListen) => {
    const server = net.createServer();
    server.once("error", () => resolveCanListen(false));
    server.once("listening", () => {
      server.close(() => resolveCanListen(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function resolveOutputPath(path: string): string {
  return resolve(process.cwd(), path);
}

function removeDirBestEffort(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[water-harness] warning: could not remove ${path}: ${message}\n`);
  }
}

function terminateProcess(entry: LaunchedProcess): void {
  if (entry.windowsTree && entry.child.pid !== undefined) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(entry.child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // fall back to ChildProcess.kill below
    }
  }
  entry.child.kill();
}
