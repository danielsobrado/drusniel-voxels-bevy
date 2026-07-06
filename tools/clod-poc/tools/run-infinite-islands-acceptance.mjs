import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "http://127.0.0.1:5173/";
const SERVER_TIMEOUT_MS = 90_000;
const SERVER_POLL_MS = 500;
const ACCEPTANCE_SOURCE = path.resolve(process.cwd(), "tools", "infinite-islands-acceptance.ts");
const FILTERED_ACCEPTANCE_SOURCE = path.resolve(process.cwd(), "tools", "infinite-islands-acceptance.filtered.tmp.ts");

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
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready with code ${server.exitCode}`);
    }
    if (await isServerReady(process.env.CLOD_POC_BASE_URL)) return server;
    await delay(SERVER_POLL_MS);
  }

  stopChildTree(server);
  throw new Error(`Timed out waiting for Vite at ${process.env.CLOD_POC_BASE_URL}`);
}

function hasFilterArgs(args) {
  return args.some((arg) => arg === "--scene" || arg.startsWith("--scene=") || arg === "--gate" || arg.startsWith("--gate="));
}

function injectedFilterBlock() {
  return [
    "const CLI_ARGS = process.argv.slice(2);",
    "",
    "function cliValues(args: readonly string[], key: string): string[] {",
    "  const values: string[] = [];",
    "  for (let i = 0; i < args.length; i++) {",
    "    const arg = args[i]!;",
    "    if (arg === key) {",
    "      const next = args[i + 1];",
    "      if (next && !next.startsWith(\"--\")) {",
    "        values.push(next);",
    "        i += 1;",
    "      }",
    "    } else if (arg.startsWith(`${key}=`)) {",
    "      const value = arg.slice(key.length + 1);",
    "      if (value.length > 0) values.push(value);",
    "    }",
    "  }",
    "  return values;",
    "}",
    "",
    "function filterActiveScenes(scenes: readonly SceneSpec[]): SceneSpec[] {",
    "  const requested = cliValues(CLI_ARGS, \"--scene\").flatMap((value) => value.split(\",\")).map((value) => value.trim()).filter(Boolean);",
    "  if (requested.length === 0) return [...scenes];",
    "  const known = new Set(SCENES.map((scene) => scene.name));",
    "  const unknown = requested.filter((name) => !known.has(name));",
    "  if (unknown.length > 0) throw new Error(`Unknown --scene value(s): ${unknown.join(\", \")}. Valid scenes: ${[...known].join(\", \")}`);",
    "  const requestedSet = new Set(requested);",
    "  return scenes.filter((scene) => requestedSet.has(scene.name));",
    "}",
    "",
    "function filterActiveGates(gates: readonly GateMode[]): GateMode[] {",
    "  const requested = cliValues(CLI_ARGS, \"--gate\").at(-1)?.trim() ?? \"all\";",
    "  if (requested === \"all\") return [...gates];",
    "  if (requested !== \"coverage\" && requested !== \"perf\") {",
    "    throw new Error(`Unknown --gate value: ${requested}. Valid gates: coverage, perf, all`);",
    "  }",
    "  return gates.filter((gate) => gate.name === requested);",
    "}",
    "",
    "const PROFILE = parseProfile(CLI_ARGS);",
    "const BASE_ACTIVE_SCENES = PROFILE === \"fast\"",
    "  ? SCENES.filter((scene) => scene.name === \"walk\" || scene.name === \"final-near\")",
    "  : PROFILE === \"reuse\"",
    "    ? [...SCENES.filter((scene) => !scene.movementRoute), ...SCENES.filter((scene) => scene.movementRoute)]",
    "    : SCENES;",
    "const ACTIVE_SCENES = filterActiveScenes(BASE_ACTIVE_SCENES);",
    "const ACTIVE_GATES = filterActiveGates(GATE_MODES);",
    "const SAMPLE_FRAMES = PROFILE === \"fast\" ? FAST_SAMPLE_FRAMES : DEFAULT_SAMPLE_FRAMES;",
  ].join("\n");
}

function injectFilteredRunner(source) {
  const activeScenesBlock = /const PROFILE = parseProfile\(process\.argv\.slice\(2\)\);\nconst ACTIVE_SCENES = PROFILE === "fast"[\s\S]*?const SAMPLE_FRAMES = PROFILE === "fast" \? FAST_SAMPLE_FRAMES : DEFAULT_SAMPLE_FRAMES;/;
  const withSceneFilter = source.replace(activeScenesBlock, injectedFilterBlock());
  if (withSceneFilter === source) throw new Error("Failed to inject infinite acceptance scene/gate filters");
  return withSceneFilter
    .replaceAll("for (const gate of GATE_MODES)", "for (const gate of ACTIVE_GATES)")
    .replace(
      "console.log(`[infinite-accept] profile ${PROFILE} scenes=${ACTIVE_SCENES.length} sampleFrames=${SAMPLE_FRAMES}`);",
      "console.log(`[infinite-accept] profile ${PROFILE} gates=${ACTIVE_GATES.map((gate) => gate.name).join(\",\")} scenes=${ACTIVE_SCENES.map((scene) => scene.name).join(\",\")} sampleFrames=${SAMPLE_FRAMES}`);",
    );
}

function prepareAcceptanceScript(args) {
  if (!hasFilterArgs(args)) return ACCEPTANCE_SOURCE;
  const source = readFileSync(ACCEPTANCE_SOURCE, "utf8");
  const filtered = injectFilteredRunner(source);
  writeFileSync(FILTERED_ACCEPTANCE_SOURCE, filtered);
  return FILTERED_ACCEPTANCE_SOURCE;
}

function cleanupFilteredScript() {
  if (!existsSync(FILTERED_ACCEPTANCE_SOURCE)) return;
  try {
    unlinkSync(FILTERED_ACCEPTANCE_SOURCE);
  } catch {
    // Best effort cleanup only.
  }
}

function runAcceptance() {
  const args = process.argv.slice(2);
  const acceptanceScript = prepareAcceptanceScript(args);
  return new Promise((resolve) => {
    const child = spawnChild("playwright", nodeBin, [tsxCli, acceptanceScript, ...args], {
      filterStdout: true,
    });
    child.on("exit", (code) => {
      cleanupFilteredScript();
      resolve(code ?? 1);
    });
  });
}

let server = null;
try {
  mkdirSync(path.dirname(FILTERED_ACCEPTANCE_SOURCE), { recursive: true });
  server = await ensureServer();
  const code = await runAcceptance();
  stopChildTree(server);
  process.exit(code);
} catch (error) {
  cleanupFilteredScript();
  stopChildTree(server);
  console.error("[infinite-accept] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
}
