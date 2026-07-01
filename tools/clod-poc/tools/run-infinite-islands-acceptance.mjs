import { spawn } from "node:child_process";

const DEFAULT_BASE_URL = "http://127.0.0.1:5173/";
const SERVER_TIMEOUT_MS = 90_000;
const SERVER_POLL_MS = 500;

process.env.CLOD_POC_BASE_URL ??= DEFAULT_BASE_URL;

const isWindows = process.platform === "win32";
const npmBin = isWindows ? "npm.cmd" : "npm";
const npxBin = isWindows ? "npx.cmd" : "npx";

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

async function ensureServer() {
  if (await isServerReady(process.env.CLOD_POC_BASE_URL)) return null;

  console.log(`[infinite-accept] starting Vite at ${process.env.CLOD_POC_BASE_URL}`);
  const server = spawnChild("vite", npmBin, ["run", "dev"]);
  const deadline = Date.now() + SERVER_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready with code ${server.exitCode}`);
    }
    if (await isServerReady(process.env.CLOD_POC_BASE_URL)) return server;
    await delay(SERVER_POLL_MS);
  }

  server.kill();
  throw new Error(`Timed out waiting for Vite at ${process.env.CLOD_POC_BASE_URL}`);
}

function runAcceptance() {
  return new Promise((resolve) => {
    const child = spawnChild("playwright", npxBin, ["tsx", "tools/infinite-islands-acceptance.ts"]);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let server = null;
try {
  server = await ensureServer();
  const code = await runAcceptance();
  if (server) server.kill();
  process.exit(code);
} catch (error) {
  if (server) server.kill();
  console.error("[infinite-accept] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
}
