import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const SERVER_TIMEOUT_MS = 120_000;
const SERVER_POLL_MS = 250;

export interface ManagedQaServer {
  child: ChildProcess | null;
  reused: boolean;
  baseUrl: string;
}

export async function ensureQaServer(
  clodRoot: string,
  baseUrl: string,
): Promise<ManagedQaServer> {
  const ready = await reachable(baseUrl);
  if (ready) {
    if (!reuseRequested()) {
      throw new Error(
        `A server is already running at ${baseUrl}. Stop it or set CLOD_POC_REUSE_SERVER=1 `
        + "to reuse it after runtime build-identity verification.",
      );
    }
    console.log(`[qa-server] explicitly reusing ${baseUrl}`);
    return { child: null, reused: true, baseUrl };
  }

  const require = createRequire(import.meta.url);
  const viteBin = require.resolve("vite/bin/vite.js");
  const port = portFor(baseUrl);
  const child = spawn(process.execPath, [
    viteBin,
    "--config",
    "vite.acceptance.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--strictPort",
  ], {
    cwd: clodRoot,
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
  child.on("error", (error) => console.error(`[qa-server] failed to start: ${error.message}`));

  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited before readiness with code ${child.exitCode}`);
    if (await reachable(baseUrl)) return { child, reused: false, baseUrl };
    await delay(SERVER_POLL_MS);
  }
  stopQaServer({ child, reused: false, baseUrl });
  throw new Error(`Vite did not become ready at ${baseUrl}`);
}

export function stopQaServer(server: ManagedQaServer): void {
  const child = server.child;
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGTERM");
}

function reuseRequested(): boolean {
  const value = process.env["CLOD_POC_REUSE_SERVER"]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function portFor(baseUrl: string): string {
  const url = new URL(baseUrl);
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

async function reachable(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    return (await fetch(baseUrl, { signal: controller.signal })).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
