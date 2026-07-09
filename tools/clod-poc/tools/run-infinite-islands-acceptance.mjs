import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const DEFAULT_BASE_URL = "http://127.0.0.1:5173/";
const SERVER_TIMEOUT_MS = 90_000;
const SERVER_POLL_MS = 500;
const ACCEPTANCE_SOURCE = path.resolve(process.cwd(), "tools", "infinite-islands-acceptance.ts");

const PHASE_SCENES = new Set([
  "phase3-far-summary-gpu-authoritative",
  "phase4-stones",
  "phase6-canopy",
]);
const FAST_SCENES = new Set(["walk", "final-near"]);
const DEFAULT_PERF_SCENES = ["walk", "biome-near", "biome-horizon", "final-near", "final-horizon"];

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

function createReuseLogFilter() {
  let buffer = "";
  const reusedScenes = new Set();

  function rewriteLine(line) {
    const reused = /^\[infinite-accept\] ([^:]+): reused page after /.exec(line);
    if (reused) reusedScenes.add(reused[1]);

    const sceneBoot = /^\[infinite-accept\] ([^:]+): scene boot: cache /.exec(line);
    if (sceneBoot && reusedScenes.has(sceneBoot[1])) {
      return `[infinite-accept] ${sceneBoot[1]}: scene boot: reused existing page; no buildWorld executed`;
    }
    return line;
  }

  return {
    write(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(`${rewriteLine(line)}\n`);
    },
    flush() {
      if (!buffer) return;
      process.stdout.write(rewriteLine(buffer));
      buffer = "";
    },
  };
}

function spawnChild(label, command, args, options = {}) {
  const pipe = label === "vite" || options.filterStdout;
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: pipe ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
  });
  child.on("error", (error) => {
    console.error(`[infinite-accept:${label}] failed to start:`, error.message);
  });
  if (child.stdout) {
    const stdoutFilter = options.filterStdout ? createReuseLogFilter() : null;
    child.stdout.on("data", (chunk) => {
      if (stdoutFilter) stdoutFilter.write(chunk);
      else process.stdout.write(`[vite] ${chunk}`);
    });
    if (stdoutFilter) child.stdout.on("end", () => stdoutFilter.flush());
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) => process.stderr.write(label === "vite" ? `[vite] ${chunk}` : chunk));
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
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready with code ${server.exitCode}`);
    if (await isServerReady(process.env.CLOD_POC_BASE_URL)) return server;
    await delay(SERVER_POLL_MS);
  }

  stopChildTree(server);
  throw new Error(`Timed out waiting for Vite at ${process.env.CLOD_POC_BASE_URL}`);
}

function cliValues(args, key) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === key) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        i += 1;
      }
    } else if (arg.startsWith(`${key}=`)) {
      const value = arg.slice(key.length + 1);
      if (value.length > 0) values.push(value);
    }
  }
  return values;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function lastCliValue(args, key) {
  return cliValues(args, key).at(-1)?.trim() ?? null;
}

function hasSceneFilter(args) {
  return args.some((arg) => arg === "--scene" || arg.startsWith("--scene="));
}

function hasGateFilter(args) {
  return args.some((arg) => arg === "--gate" || arg.startsWith("--gate="));
}

function phaseSceneAlias(name) {
  if (name === "coverage/phase3-far-summary-gpu-authoritative") return "phase3-far-summary-gpu-authoritative";
  if (name === "coverage/phase4-stones") return "phase4-stones";
  if (name === "coverage/phase6-canopy") return "phase6-canopy";
  return name;
}

function requestedScenes(args) {
  return cliValues(args, "--scene")
    .flatMap((value) => value.split(","))
    .map((value) => phaseSceneAlias(value.trim()))
    .filter(Boolean);
}

function appendSceneFilter(args, scenes) {
  return [...args, "--scene", scenes.join(",")];
}

function stripGateArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--gate") {
      i += 1;
      continue;
    }
    if (arg.startsWith("--gate=")) continue;
    out.push(arg);
  }
  return out;
}

function normalizeAcceptanceArgs(args) {
  const scenes = requestedScenes(args);
  const fastUnsupportedScenes = hasFlag(args, "--fast") ? scenes.filter((scene) => !FAST_SCENES.has(scene)) : [];
  if (fastUnsupportedScenes.length > 0) {
    throw new Error(`--fast only supports ${[...FAST_SCENES].join(", ")}; unsupported scene(s): ${fastUnsupportedScenes.join(", ")}`);
  }

  const hasPhaseScene = scenes.some((scene) => PHASE_SCENES.has(scene));
  const gate = lastCliValue(args, "--gate") ?? "all";

  if (hasPhaseScene) {
    if (gate === "perf") {
      throw new Error("Phase coverage scenes are coverage-only; use --gate coverage.");
    }
    if (gate === "all" || !hasGateFilter(args)) {
      return [...stripGateArgs(args), "--gate", "coverage"];
    }
    return args;
  }

  if (!hasSceneFilter(args) && (gate === "perf" || gate === "all" || !hasGateFilter(args))) {
    return appendSceneFilter(args, DEFAULT_PERF_SCENES);
  }

  return args;
}

function runAcceptance(args) {
  return new Promise((resolve, reject) => {
    const child = spawnChild("acceptance", nodeBin, [tsxCli, ACCEPTANCE_SOURCE, ...args], { filterStdout: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Acceptance exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`));
    });
  });
}

async function main() {
  const server = await ensureServer();
  try {
    const args = normalizeAcceptanceArgs(process.argv.slice(2));
    await runAcceptance(args);
  } finally {
    if (server) stopChildTree(server);
  }
}

main().catch((error) => {
  console.error("[infinite-accept] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
