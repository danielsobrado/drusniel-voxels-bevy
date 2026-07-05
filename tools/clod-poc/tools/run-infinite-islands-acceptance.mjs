import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const DEFAULT_BASE_URL = "http://127.0.0.1:5173/";
const SERVER_TIMEOUT_MS = 90_000;
const SERVER_POLL_MS = 500;

process.env.CLOD_POC_BASE_URL ??= DEFAULT_BASE_URL;

const isWindows = process.platform === "win32";
const viteBin = path.resolve(process.cwd(), "node_modules", "vite", "bin", "vite.js");
const tsxCli = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const nodeBin = process.execPath;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerReady(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function spawnChild(label, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: label === "vite" ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
  });
  child.on("error", (error) => {
    console.error(`[infinite-accept:${label}] failed to start:`, error.message);
  });
  if (child.stdout) {
    child.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
  }
  return child;
}

function stopChildTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

function baseUrlPort(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return "5173";
  }
}

function viteArgs(baseUrl) {
  const port = baseUrlPort(baseUrl);
  return ["--config", "vite.acceptance.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
}

function reuseExistingServer() {
  return process.env.CLOD_POC_REUSE_SERVER === "1" || process.env.CLOD_POC_REUSE_SERVER === "true";
}

async function ensureServer() {
  const baseUrl = process.env.CLOD_POC_BASE_URL ?? DEFAULT_BASE_URL;
  const alreadyReady = await isServerReady(baseUrl);
  if (alreadyReady && reuseExistingServer()) {
    console.log(`[infinite-accept] reusing existing Vite at ${baseUrl}`);
    return null;
  }
  if (alreadyReady) {
    throw new Error(
      `A server is already running at ${baseUrl}. Stop it, set CLOD_POC_BASE_URL to a free port, ` +
        `or set CLOD_POC_REUSE_SERVER=1 to intentionally reuse it.`,
    );
  }

  console.log(`[infinite-accept] starting Vite at ${baseUrl}`);
  const server = spawnChild("vite", nodeBin, [viteBin, ...viteArgs(baseUrl)]);
  const deadline = Date.now() + SERVER_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready with code ${server.exitCode}`);
    }
    if (await isServerReady(process.env.CLOD_POC_BASE_URL)) return server;
    await delay(SERVER_POLL_MS);
  }

  stopChildTree(server);
  throw new Error(`Timed out waiting for Vite at ${process.env.CLOD_POC_BASE_URL}`);
}

function runAcceptance() {
  return new Promise((resolve) => {
    const child = spawnChild("playwright", nodeBin, [tsxCli, "tools/infinite-islands-acceptance.ts", ...process.argv.slice(2)]);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let server = null;
try {
  server = await ensureServer();
  const code = await runAcceptance();
  stopChildTree(server);
  process.exit(code);
} catch (error) {
  stopChildTree(server);
  console.error("[infinite-accept] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
}
