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
    "function acceptanceSceneAlias(name: string): string {",
    "  if (name === \"coverage/phase4-stones\") return \"phase4-stones\";",
    "  if (name === \"coverage/phase6-canopy\") return \"phase6-canopy\";",
    "  return name;",
    "}",
    "",
    "function filterActiveScenes(scenes: readonly SceneSpec[]): SceneSpec[] {",
    "  const requested = cliValues(CLI_ARGS, \"--scene\").flatMap((value) => value.split(\",\")).map((value) => acceptanceSceneAlias(value.trim())).filter(Boolean);",
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

function injectPhaseAcceptanceScenes(source) {
  const sceneNeedle = "  {\n    name: \"biome-near\",";
  const injectedScenes = [
    "  {",
    "    name: \"phase4-stones\",",
    "    freeze: true,",
    "    proceduralDebug: \"biome\",",
    "    cam: OUTSIDE_STARTUP_CAM,",
    "    extra: { gpuReadbacks: \"acceptance\", stoneGpuCounts: \"1\" },",
    "    validation: \"stone-gpu\",",
    "  },",
    "  {",
    "    name: \"phase6-canopy\",",
    "    freeze: true,",
    "    proceduralDebug: \"biome\",",
    "    cam: OUTSIDE_STARTUP_CAM,",
    "    extra: { canopy: \"1\", farClipmap: \"1\", farClipmapMode: \"replace\", farClipmapShaderDisplacement: \"1\" },",
    "    validation: \"phase6-canopy\",",
    "  },",
  ].join("\n");
  const withScene = source.includes(sceneNeedle)
    ? source.replace(sceneNeedle, `${injectedScenes}\n${sceneNeedle}`)
    : source;
  if (withScene === source) throw new Error("Failed to inject phase acceptance scenes");

  const withSceneSpec = withScene.replace(
    "  movementRoute?: boolean;\n}",
    "  movementRoute?: boolean;\n  validation?: \"stone-gpu\" | \"phase6-canopy\";\n}",
  );
  if (withSceneSpec === withScene) throw new Error("Failed to inject scene validation type");

  const evaluator = [
    "function numericCounter(stats: JsonRecord, key: string): number {",
    "  const counters = stats[\"counters\"] as Record<string, unknown> | undefined;",
    "  const value = counters?.[key] ?? stats[key];",
    "  return typeof value === \"number\" && Number.isFinite(value) ? value : Number.NaN;",
    "}",
    "",
    "function evaluateStoneGpuCounters(stats: JsonRecord): string[] {",
    "  const failures: string[] = [];",
    "  const counters = (stats[\"counters\"] as Record<string, unknown> | undefined) ?? {};",
    "  const total = numericCounter(stats, \"stoneGpuClustersTotal\");",
    "  const accepted = numericCounter(stats, \"stoneGpuClustersAccepted\");",
    "  const rejected = numericCounter(stats, \"stoneGpuClustersRejectedEarly\");",
    "  const vegetationTotal = numericCounter(stats, \"vegetationGpuClustersTotal\");",
    "  const centerDistance = numericCounter(stats, \"camera_to_vegetation_ring_center_m\");",
    "  if (!(total > 0)) failures.push(`stoneGpuClustersTotal=${total} must be > 0; this validates the real WebGPU stone path and will fail in headless/SwiftShader`);",
    "  if (!Number.isFinite(accepted) || accepted < 0) failures.push(`stoneGpuClustersAccepted=${accepted} must be finite and >= 0`);",
    "  if (!Number.isFinite(rejected) || rejected < 0) failures.push(`stoneGpuClustersRejectedEarly=${rejected} must be finite and >= 0`);",
    "  if (Number.isFinite(total) && Number.isFinite(accepted) && Number.isFinite(rejected) && accepted + rejected > total) {",
    "    failures.push(`stone accepted+rejected ${accepted + rejected} exceeds total ${total}`);",
    "  }",
    "  if (Number.isFinite(total) && (!(vegetationTotal >= total))) failures.push(`vegetationGpuClustersTotal=${vegetationTotal} must include stone total ${total}`);",
    "  if (Number.isFinite(centerDistance) && !(centerDistance <= 8)) failures.push(`camera_to_vegetation_ring_center_m=${centerDistance} must be <= 8`);",
    "  for (const key of [\"stoneReject.below_water\", \"stoneReject.too_steep\", \"stoneReject.outside_world\", \"stoneReject.too_far\", \"stoneReject.density_mask\", \"stoneReject.tile_budget\", \"stoneReject.class_budget\", \"stoneReject.terrain_hidden\"]) {",
    "    const value = numericCounter(stats, key);",
    "    if (Number.isFinite(value) && value < 0) failures.push(`${key}=${value} must be >= 0`);",
    "  }",
    "  const forbidden = Object.keys(counters).filter((key) => key.startsWith(\"veg_gpu_\"));",
    "  if (forbidden.length > 0) failures.push(`forbidden veg_gpu_* counters present: ${forbidden.join(\", \")}`);",
    "  return failures;",
    "}",
    "",
    "function evaluatePhase6CanopyCounters(stats: JsonRecord): string[] {",
    "  const failures: string[] = [];",
    "  const enabled = numericCounter(stats, \"canopy_gpu_impostor_enabled\");",
    "  const instances = numericCounter(stats, \"canopy_gpu_impostor_instances\");",
    "  const shellTris = numericCounter(stats, \"canopy_shell_tris\");",
    "  const maxColor = numericCounter(stats, \"canopy_gpu_impostor_max_color_channel\");",
    "  const opacity = numericCounter(stats, \"canopy_gpu_impostor_opacity\");",
    "  const shaderDisplacement = numericCounter(stats, \"far_clipmap_shader_displacement_enabled\");",
    "  const pendingTiles = numericCounter(stats, \"far_clipmap_pending_tiles\");",
    "  if (enabled !== 1) failures.push(`canopy_gpu_impostor_enabled=${enabled} must equal 1`);",
    "  if (!(instances > 0)) failures.push(`canopy_gpu_impostor_instances=${instances} must be > 0`);",
    "  if (Number.isFinite(instances) && Number.isFinite(shellTris) && shellTris !== instances * 2) failures.push(`canopy_shell_tris=${shellTris} must equal canopy_gpu_impostor_instances*2 (${instances * 2})`);",
    "  if (!(maxColor <= 0.42)) failures.push(`canopy_gpu_impostor_max_color_channel=${maxColor} must be <= 0.42`);",
    "  if (!(opacity < 0.7)) failures.push(`canopy_gpu_impostor_opacity=${opacity} must be < 0.7`);",
    "  if (shaderDisplacement !== 1) failures.push(`far_clipmap_shader_displacement_enabled=${shaderDisplacement} must equal 1`);",
    "  if (pendingTiles !== 0) failures.push(`far_clipmap_pending_tiles=${pendingTiles} must equal 0`);",
    "  return failures;",
    "}",
    "",
    "function evaluateSceneSpecificCounters(scene: SceneSpec, stats: JsonRecord): string[] {",
    "  if (scene.validation === \"stone-gpu\") return evaluateStoneGpuCounters(stats);",
    "  if (scene.validation === \"phase6-canopy\") return evaluatePhase6CanopyCounters(stats);",
    "  return [];",
    "}",
    "",
  ].join("\n");
  const withEvaluator = withSceneSpec.replace("function evaluateMovementRoute", `${evaluator}function evaluateMovementRoute`);
  if (withEvaluator === withSceneSpec) throw new Error("Failed to inject scene counter evaluator");

  const withConvergenceOptOut = withEvaluator.replace(
    "    await Promise.race([waitForConvergence(page, sceneRunName), pageErrorGate]);",
    "    if (scene.validation === \"stone-gpu\") {\n      console.log(`[infinite-accept] ${sceneRunName}: skipping generic convergence wait for stone-gpu validation`);\n    } else {\n      await Promise.race([waitForConvergence(page, sceneRunName), pageErrorGate]);\n    }",
  );
  if (withConvergenceOptOut === withEvaluator) throw new Error("Failed to inject stone convergence opt-out");

  const withThresholdOptOut = withConvergenceOptOut.replace(
    "    const thresholds: ThresholdEvaluation = evaluateThresholds(\n      extractAcceptanceCounters(stats),\n      gate.requiredCounters,\n      gate.rules,\n    );",
    "    const thresholds: ThresholdEvaluation = scene.validation\n      ? evaluateThresholds(extractAcceptanceCounters(stats), [], [])\n      : evaluateThresholds(\n        extractAcceptanceCounters(stats),\n        gate.requiredCounters,\n        gate.rules,\n      );",
  );
  if (withThresholdOptOut === withConvergenceOptOut) throw new Error("Failed to inject scene threshold opt-out");

  const withFailures = withThresholdOptOut.replace(
    "    const movementFailures = evaluateMovementRoute(scene.name, movement);\n    const failures = [",
    "    const movementFailures = evaluateMovementRoute(scene.name, movement);\n    const sceneSpecificFailures = evaluateSceneSpecificCounters(scene, stats);\n    const failures = [",
  ).replace(
    "      ...movementFailures,\n      ...imageSanity.failures.map((failure) => `image sanity: ${failure}`),",
    "      ...movementFailures,\n      ...sceneSpecificFailures,\n      ...imageSanity.failures.map((failure) => `image sanity: ${failure}`),",
  );
  if (withFailures === withThresholdOptOut) throw new Error("Failed to inject scene counter failures");
  return withFailures;
}

function injectFilteredRunner(source) {
  const activeScenesBlock = /const PROFILE = parseProfile\(process\.argv\.slice\(2\)\);\nconst ACTIVE_SCENES = PROFILE === "fast"[\s\S]*?const SAMPLE_FRAMES = PROFILE === "fast" \? FAST_SAMPLE_FRAMES : DEFAULT_SAMPLE_FRAMES;/;
  const withPhaseScenes = injectPhaseAcceptanceScenes(source);
  const withSceneFilter = withPhaseScenes.replace(activeScenesBlock, injectedFilterBlock());
  if (withSceneFilter === withPhaseScenes) throw new Error("Failed to inject infinite acceptance scene/gate filters");
  return withSceneFilter
    .replaceAll("for (const gate of GATE_MODES)", "for (const gate of ACTIVE_GATES)")
    .replace(
      "console.log(`[infinite-accept] profile ${PROFILE} scenes=${ACTIVE_SCENES.length} sampleFrames=${SAMPLE_FRAMES}`);",
      "console.log(`[infinite-accept] profile ${PROFILE} gates=${ACTIVE_GATES.map((gate) => gate.name).join(\",\")} scenes=${ACTIVE_SCENES.map((scene) => scene.name).join(\",\")} sampleFrames=${SAMPLE_FRAMES}`);",
    );
}

function prepareAcceptanceScript(args) {
  if (!hasFilterArgs(args)) return ACCEPTANCE_SOURCE;
  const source = readFileSync(ACCEPTANCE_SOURCE, "utf8").replaceAll("\r\n", "\n");
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
