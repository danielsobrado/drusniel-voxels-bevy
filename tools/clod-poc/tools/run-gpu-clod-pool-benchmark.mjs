import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const DEFAULT_BASE_URL = "http://127.0.0.1:5173/";
const SERVER_TIMEOUT_MS = 90_000;
const SERVER_POLL_MS = 500;
const BENCHMARK_SOURCE = path.resolve(process.cwd(), "tools", "benchmark-gpu-clod-pools.ts");

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

function spawnChild(label, command, args, pipeOutput = false) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: pipeOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
  });
  child.on("error", (error) => console.error(`[gpu-clod-pools:${label}] failed to start: ${error.message}`));
  child.stdout?.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
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

function reuseExistingServer() {
  return process.env.CLOD_POC_REUSE_SERVER === "1" || process.env.CLOD_POC_REUSE_SERVER === "true";
}

async function ensureServer() {
  const baseUrl = process.env.CLOD_POC_BASE_URL ?? DEFAULT_BASE_URL;
  const alreadyReady = await isServerReady(baseUrl);
  if (alreadyReady && reuseExistingServer()) {
    console.log(`[gpu-clod-pools] reusing existing Vite at ${baseUrl}`);
    return null;
  }
  if (alreadyReady) {
    throw new Error(
      `A server is already running at ${baseUrl}. Stop it, choose another CLOD_POC_BASE_URL, `
      + "or set CLOD_POC_REUSE_SERVER=1 to reuse it intentionally.",
    );
  }

  const port = baseUrlPort(baseUrl);
  console.log(`[gpu-clod-pools] starting Vite at ${baseUrl}`);
  const server = spawnChild(
    "vite",
    nodeBin,
    [viteBin, "--config", "vite.acceptance.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    true,
  );
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready with code ${server.exitCode}`);
    if (await isServerReady(baseUrl)) return server;
    await delay(SERVER_POLL_MS);
  }
  stopChildTree(server);
  throw new Error(`Timed out waiting for Vite at ${baseUrl}`);
}

function runBenchmark(args) {
  return new Promise((resolve, reject) => {
    const child = spawnChild("benchmark", nodeBin, [tsxCli, BENCHMARK_SOURCE, ...args]);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Benchmark exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`));
    });
  });
}

async function main() {
  const server = await ensureServer();
  try {
    await runBenchmark(process.argv.slice(2));
  } finally {
    if (server) stopChildTree(server);
  }
}

main().catch((error) => {
  console.error("[gpu-clod-pools] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
