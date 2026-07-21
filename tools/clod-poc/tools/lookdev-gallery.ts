import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dump } from "js-yaml";
import type { BrowserContext, Page } from "playwright";
import { launchWebGPU } from "./launch.js";
import { assertRuntimeQaBuildIdentity, currentQaBuildIdentity } from "./qa-build-identity.js";
import { waitForQaConvergence, type QaConvergenceEvidence } from "./qa-convergence.js";
import { ensureQaServer, stopQaServer } from "./qa-managed-server.js";
import { buildImageSignature, type QaImageSignature } from "../src/qa/unified/image_signature.js";
import { loadLinearImage } from "../src/qa/unified/image_linear.js";
import { evaluateRegionProbe, type RegionProbeResult } from "../src/qa/unified/region_probes.js";
import { loadLookdevConfig, type LookdevConfig, type LookdevPose, type LookdevToneMap } from "../src/qa/lookdev/lookdev_config.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const CLOD_ROOT = resolve(REPOSITORY_ROOT, "tools/clod-poc");
const DEFAULT_CONFIG = resolve(CLOD_ROOT, "config/lookdev_qa.yaml");
const DEFAULT_BASE_URL = "http://127.0.0.1:5173/";
const CAPTURE_WARMUP_FRAMES = 30;
const FINAL_SETTLE_FRAMES = 8;

interface Args {
  mode: "discover" | "gate";
  suite: "smoke" | "full";
  config: string;
  output: string;
  baseUrl: string;
  poseIds: string[];
  toneMaps: LookdevToneMap[];
  params: URLSearchParams;
}

interface LookdevCapture {
  toneMap: LookdevToneMap;
  pose: LookdevPose;
  file: string;
  signature: QaImageSignature;
  sanity: RegionProbeResult;
  stableCounters: Record<string, number>;
  convergence: QaConvergenceEvidence;
  consoleWarnings: string[];
}

interface PageMessages {
  errors: string[];
  warnings: string[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadLookdevConfig(args.config);
  const expectedBuild = currentQaBuildIdentity(REPOSITORY_ROOT, CLOD_ROOT);
  mkdirSync(args.output, { recursive: true });
  const server = await ensureQaServer(CLOD_ROOT, args.baseUrl);
  const { browser, recipe } = await launchWebGPU();
  const context = await browser.newContext({
    viewport: { width: config.viewport[0], height: config.viewport[1] },
    deviceScaleFactor: 1,
  });
  try {
    const discovered = args.mode === "discover"
      ? await discoverPoses(context, config, args, expectedBuild)
      : null;
    const poses = selectPoses(config, args, discovered);
    const toneMaps = selectToneMaps(config, args);
    const captures: LookdevCapture[] = [];
    const failures: string[] = [];
    for (const toneMap of toneMaps) {
      const result = await captureToneMap(context, config, args, expectedBuild, toneMap, poses);
      captures.push(...result.captures);
      failures.push(...result.failures);
    }
    if (args.mode === "discover" && discovered) writeDiscoveredPoses(args.output, config, discovered);
    writeOutputs(args, config, recipe, captures, failures);
    if (args.mode === "gate" && failures.length > 0) {
      throw new Error(`lookdev ${args.suite} failed:\n- ${failures.join("\n- ")}`);
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    stopQaServer(server);
  }
}

async function discoverPoses(
  context: BrowserContext,
  config: LookdevConfig,
  args: Args,
  expectedBuild: ReturnType<typeof currentQaBuildIdentity>,
): Promise<LookdevPose[]> {
  const page = await context.newPage();
  try {
    await bootPage(page, config, args, expectedBuild, "agx");
    const poses = await page.evaluate<LookdevPose[]>(`(() => {
      const probe = window.waterProbe;
      if (typeof probe !== "function") throw new Error("window.waterProbe is required for lookdev discovery");
      const terrain = (x, z) => probe(x, z).terrain;
      const poses = [];
      let spot = null;
      for (let z = 256; z < 4096; z += 24) {
        for (let x = 256; x < 4096; x += 24) {
          const s = probe(x, z);
          if (s.bodyMask < 0.9 || s.depth < 1 || Math.hypot(s.flowX, s.flowZ) < 0.5) continue;
          if (!spot || s.depth > spot.depth) {
            const len = Math.hypot(s.flowX, s.flowZ);
            spot = { x, z, depth: s.depth, fx: s.flowX / len, fz: s.flowZ / len };
          }
        }
      }
      if (spot) {
        const yaw = Math.atan2(-spot.fx, -spot.fz);
        const closeX = spot.x - spot.fx * 70;
        const closeZ = spot.z - spot.fz * 70;
        poses.push({ id: "river-close", position: [closeX, terrain(closeX, closeZ) + 18, closeZ], yaw, pitch: -0.28, fov: 55, diagnostic: "final" });
        poses.push({ id: "river-aerial", position: [spot.x, terrain(spot.x, spot.z) + 420, spot.z], yaw, pitch: -1.5, fov: 55, diagnostic: "final" });
      }
      let ridge = { x: 1024, z: 1024, y: -Infinity };
      for (let z = 256; z < 4096; z += 48) for (let x = 256; x < 4096; x += 48) {
        const y = terrain(x, z);
        if (y > ridge.y) ridge = { x, z, y };
      }
      poses.push({ id: "ridge", position: [ridge.x, ridge.y + 26, ridge.z], yaw: Math.PI * 0.75, pitch: -0.12, fov: 55, diagnostic: "final" });
      let ocean = { x: 512, z: 512, y: Infinity };
      for (let z = 128; z < 4224; z += 48) for (let x = 128; x < 4224; x += 48) {
        const y = terrain(x, z);
        if (y < ocean.y) ocean = { x, z, y };
      }
      let sx = ocean.x, sz = ocean.z;
      for (let i = 0; i < 80 && terrain(sx, sz) < 23; i++) {
        const gx = terrain(sx + 12, sz) - terrain(sx - 12, sz);
        const gz = terrain(sx, sz + 12) - terrain(sx, sz - 12);
        const len = Math.hypot(gx, gz) || 1;
        sx += gx / len * 18;
        sz += gz / len * 18;
      }
      poses.push({ id: "coast", position: [sx, terrain(sx, sz) + 14, sz], yaw: Math.atan2(-(ocean.x - sx), -(ocean.z - sz)), pitch: -0.14, fov: 55, diagnostic: "final" });
      let valley = { x: 1024, z: 1024, y: Infinity };
      for (let z = 512; z < 3840; z += 48) for (let x = 512; x < 3840; x += 48) {
        const y = terrain(x, z);
        if (y > 22 && y < valley.y) valley = { x, z, y };
      }
      poses.push({ id: "valley", position: [valley.x, valley.y + 22, valley.z], yaw: Math.PI * 0.25, pitch: -0.2, fov: 55, diagnostic: "final" });
      const seam = poses.find((pose) => pose.id === "ridge") || poses[0];
      if (seam) {
        poses.push({ ...seam, id: "seam-grazing", yaw: seam.yaw + Math.PI * 0.5, pitch: -0.1 });
        poses.push({ ...seam, id: "ownership", diagnostic: "ownership" });
      }
      return poses;
    })()`);
    if (poses.length === 0) throw new Error("lookdev discovery produced no poses");
    return poses;
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function captureToneMap(
  context: BrowserContext,
  config: LookdevConfig,
  args: Args,
  expectedBuild: ReturnType<typeof currentQaBuildIdentity>,
  toneMap: LookdevToneMap,
  poses: readonly LookdevPose[],
): Promise<{ captures: LookdevCapture[]; failures: string[] }> {
  const page = await context.newPage();
  const messages = pageMessages(page);
  const captures: LookdevCapture[] = [];
  const failures: string[] = [];
  try {
    await bootPage(page, config, args, expectedBuild, toneMap);
    if (messages.errors.length > 0) throw new Error(messages.errors[0]);
    await page.addStyleTag({ content: "body > *:not(canvas) { visibility: hidden !important; }" });
    for (const pose of poses) {
      messages.errors.length = 0;
      messages.warnings.length = 0;
      await page.evaluate(async ({ nextPose, diagnostic, warmupFrames }) => {
        const hook = window.__drusnielQa;
        if (!hook) throw new Error("window.__drusnielQa is missing");
        await hook.unfreeze();
        await hook.setDiagnosticBuffer(diagnostic);
        await hook.setPose({ p: nextPose.position, yaw: nextPose.yaw, pitch: nextPose.pitch, fov: nextPose.fov });
        await hook.settle(warmupFrames);
      }, { nextPose: pose, diagnostic: pose.diagnostic, warmupFrames: CAPTURE_WARMUP_FRAMES });
      const convergence = await waitForQaConvergence(page, `lookdev:${toneMap}:${pose.id}`, config.readyTimeoutMs, config.stablePolls);
      await page.evaluate(async (settleFrames) => {
        await window.__drusnielQa?.freeze();
        await window.__drusnielQa?.settle(settleFrames);
      }, FINAL_SETTLE_FRAMES);
      if (messages.errors.length > 0) failures.push(`${toneMap}/${pose.id}: ${messages.errors[0]}`);
      const file = `${toneMap}-${pose.id}.png`;
      const imagePath = resolve(args.output, file);
      await page.screenshot({ path: imagePath, animations: "disabled", caret: "hide" });
      const image = await loadLinearImage(imagePath);
      const sanity = evaluateRegionProbe(image, {
        id: "frame-sanity",
        rect_normalized: [0, 0, 1, 1],
        gates: {
          luminance_mean: { min: 0.01, max: 0.95 },
          luminance_stddev: { min: 0.005 },
          black_pixel_fraction: { max: 0.75 },
          clipped_pixel_fraction: { max: 0.35 },
          edge_magnitude: { min: 0.0001 },
        },
      });
      if (sanity.status === "FAIL") failures.push(`${toneMap}/${pose.id}: ${sanity.failures.join("; ")}`);
      const stats = await page.evaluate(async () => window.__drusnielQa?.captureStats());
      if (!stats) throw new Error(`${toneMap}/${pose.id}: runtime stats are missing`);
      const stableCounters = Object.fromEntries(Object.entries(stats.counters)
        .filter(([key]) => /(?:signature|hash|triangles|draw_calls|visible|errors|failures)$/u.test(key))
        .sort(([left], [right]) => left.localeCompare(right)));
      captures.push({
        toneMap,
        pose,
        file,
        signature: buildImageSignature(image),
        sanity,
        stableCounters,
        convergence,
        consoleWarnings: [...messages.warnings],
      });
      await page.evaluate(async () => window.__drusnielQa?.setDiagnosticBuffer("final"));
    }
  } catch (error) {
    failures.push(`${toneMap}: ${errorMessage(error)}`);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { captures, failures };
}

async function bootPage(
  page: Page,
  config: LookdevConfig,
  args: Args,
  expectedBuild: ReturnType<typeof currentQaBuildIdentity>,
  toneMap: LookdevToneMap,
): Promise<void> {
  const url = lookdevUrl(config, args, toneMap);
  console.log(`[lookdev] boot ${toneMap}: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.readyTimeoutMs });
  await page.waitForFunction(() => window.__drusnielQa !== undefined, undefined, { timeout: config.readyTimeoutMs, polling: 100 });
  await assertRuntimeQaBuildIdentity(page, expectedBuild);
  await waitForQaConvergence(page, `lookdev:${toneMap}:boot`, config.readyTimeoutMs, config.stablePolls);
}

function selectPoses(config: LookdevConfig, args: Args, discovered: LookdevPose[] | null): LookdevPose[] {
  const source = discovered ?? config.poses;
  const requested = args.poseIds.length > 0 ? args.poseIds : config.suites[args.suite].poses;
  const byId = new Map(source.map((pose) => [pose.id, pose]));
  const poses = requested.map((id) => {
    const pose = byId.get(id);
    if (!pose) throw new Error(`unknown lookdev pose ${id}`);
    return pose;
  });
  if (poses.length === 0) throw new Error("no lookdev poses selected");
  return poses;
}

function selectToneMaps(config: LookdevConfig, args: Args): LookdevToneMap[] {
  return args.toneMaps.length > 0 ? args.toneMaps : config.suites[args.suite].toneMaps;
}

function lookdevUrl(config: LookdevConfig, args: Args, toneMap: LookdevToneMap): string {
  const url = new URL(args.baseUrl);
  const params = new URLSearchParams({
    scene: config.scene,
    seed: String(config.seed),
    world: String(config.world),
    toneMap,
    ...config.profile,
  });
  if (args.mode === "discover") for (const [key, value] of args.params) params.set(key, value);
  for (const [key, value] of params) url.searchParams.set(key, value);
  return url.toString();
}

function pageMessages(page: Page): PageMessages {
  const messages: PageMessages = { errors: [], warnings: [] };
  page.on("pageerror", (error) => messages.errors.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/iu.test(message.text())) messages.errors.push(`console error: ${message.text()}`);
    if (message.type() === "warning") messages.warnings.push(message.text());
  });
  return messages;
}

function writeDiscoveredPoses(output: string, config: LookdevConfig, poses: readonly LookdevPose[]): void {
  const value = {
    lookdev_discovery: {
      schema_version: 1,
      source_scene: config.scene,
      seed: config.seed,
      world: config.world,
      poses: poses.map((pose) => ({
        id: pose.id,
        position: pose.position.map(round),
        yaw: round(pose.yaw),
        pitch: round(pose.pitch),
        fov: pose.fov,
        diagnostic: pose.diagnostic,
      })),
    },
  };
  writeFileSync(resolve(output, "discovered-poses.yaml"), dump(value, { noRefs: true, lineWidth: 120 }));
}

function writeOutputs(
  args: Args,
  _config: LookdevConfig,
  launchRecipe: unknown,
  captures: readonly LookdevCapture[],
  failures: readonly string[],
): void {
  const report = {
    schemaVersion: 1,
    mode: args.mode,
    suite: args.suite,
    canonical: args.mode === "gate" && args.params.size === 0,
    config: args.config,
    launchRecipe,
    passed: failures.length === 0,
    failures,
    captures,
  };
  writeJson(resolve(args.output, "report.json"), report);
  writeJson(resolve(args.output, "determinism.json"), {
    schemaVersion: 1,
    suite: args.suite,
    captures: captures.map((capture) => ({
      toneMap: capture.toneMap,
      pose: capture.pose,
      signature: capture.signature,
      sanity: capture.sanity,
      stableCounters: capture.stableCounters,
    })),
  });
  const poseIds = [...new Set(captures.map((capture) => capture.pose.id))];
  const toneMaps = [...new Set(captures.map((capture) => capture.toneMap))];
  const lines = [
    "# Lookdev gallery",
    "",
    `Mode: **${args.mode}**`,
    `Suite: **${args.suite}**`,
    `Status: **${failures.length === 0 ? "PASS" : "FAIL"}**`,
    "",
    "| pose | " + toneMaps.map((toneMap) => `toneMap=${toneMap}`).join(" | ") + " |",
    "| --- | " + toneMaps.map(() => "---").join(" | ") + " |",
    ...poseIds.map((poseId) => `| ${poseId} | ${toneMaps.map((toneMap) => {
      const capture = captures.find((entry) => entry.pose.id === poseId && entry.toneMap === toneMap);
      return capture ? `![${toneMap}-${poseId}](${capture.file})` : "-";
    }).join(" | ")} |`),
    "",
  ];
  if (failures.length > 0) lines.push("## Failures", "", ...failures.map((failure) => `- ${failure}`), "");
  writeFileSync(resolve(args.output, "gallery.md"), `${lines.join("\n")}\n`);
  console.log(`[lookdev] ${args.mode}/${args.suite} ${failures.length === 0 ? "PASS" : "FAIL"}: ${resolve(args.output, "gallery.md")}`);
}

function parseArgs(argv: readonly string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) throw new Error(`unexpected lookdev argument ${String(arg)}`);
    const equals = arg.indexOf("=");
    if (equals > 2) {
      values.set(arg.slice(2, equals), arg.slice(equals + 1));
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`missing value for ${arg}`);
    values.set(arg.slice(2), next);
    index++;
  }
  const mode = values.get("mode") ?? "gate";
  if (mode !== "discover" && mode !== "gate") throw new Error("--mode must be discover or gate");
  const suite = values.get("suite") ?? "smoke";
  if (suite !== "smoke" && suite !== "full") throw new Error("--suite must be smoke or full");
  const toneMaps = split(values.get("toneMap")).map((value) => {
    if (value !== "agx" && value !== "aces") throw new Error(`unsupported tone map ${value}`);
    return value;
  });
  const params = new URLSearchParams(values.get("params") ?? "");
  if (mode === "gate" && params.size > 0) throw new Error("--params is discovery-only; deterministic lookdev gates use committed config");
  const output = resolve(values.get("out") ?? `qa-runs/lookdev-${mode}-${suite}`);
  return {
    mode,
    suite,
    config: resolve(values.get("config") ?? DEFAULT_CONFIG),
    output,
    baseUrl: values.get("url") ?? process.env["CLOD_POC_BASE_URL"] ?? DEFAULT_BASE_URL,
    poseIds: split(values.get("poses")),
    toneMaps,
    params,
  };
}

function split(value: string | undefined): string[] {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}
function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }

main().catch((error) => {
  console.error(`[lookdev] FAILED: ${errorMessage(error)}`);
  process.exitCode = 1;
});
