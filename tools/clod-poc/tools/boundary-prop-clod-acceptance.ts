import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Page } from "playwright";
import { clodUrl, launchWebGPU } from "./launch.js";
import { settlePage } from "./infinite_acceptance/page_settle.js";
import {
  evaluateBoundaryPropClodEvidence,
  type BoundaryPropClodEvidence,
  type BoundaryPropProbe,
} from "./boundary_prop_clod/contract.js";

const READY_TIMEOUT_MS = 360_000;
const CONVERGENCE_TIMEOUT_MS = 360_000;
const SETTLE_TIMEOUT_MS = 30_000;
const OUTPUT_DIR = resolve("acceptance-runs/boundary-prop-clod");
const BOUNDARY_CENTER_X = 7456;
const BOUNDARY_CENTER_Z = 0;
const COVERAGE_OFFSET_M = 0.5;

const PLACEMENTS = [
  { assetId: "crate_a", x: 7392, z: -32, rotationY: 0.2, scale: 1 },
  { assetId: "rock_large_01", x: 7424, z: 0, rotationY: 0.8, scale: 1.1 },
  { assetId: "stone_ruin_wall", x: 7456, z: 32, rotationY: -0.3, scale: 1 },
  { assetId: "crate_a", x: 7488, z: -64, rotationY: 1.4, scale: 1 },
  { assetId: "rock_large_01", x: 7520, z: 64, rotationY: -1.1, scale: 1.2 },
] as const;

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hooks = window.__drusnielClod;
    return Boolean(hooks && (hooks.ready === true || hooks.error != null));
  }, undefined, { timeout: READY_TIMEOUT_MS, polling: 250 });

  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(`CLOD-POC boot failed: ${error}`);
}

async function waitForConvergence(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const counters = window.__drusnielClod?.stats?.counters ?? {};
    const required = counters["live_clod_stream_required_pages"] ?? 0;
    return required > 0
      && (counters["live_clod_stream_pending_pages"] ?? -1) === 0
      && (counters["live_clod_stream_inflight_batches"] ?? -1) === 0
      && (counters["live_clod_stream_failed_pages"] ?? -1) === 0
      && (counters["live_clod_stream_safety_pending_pages"] ?? -1) === 0
      && (counters["live_clod_stream_safety_inflight_pages"] ?? -1) === 0
      && (counters["live_clod_stream_refinement_pending_pages"] ?? -1) === 0
      && (counters["live_clod_stream_refinement_inflight_pages"] ?? -1) === 0
      && (counters["live_clod_stream_parent_coverage_violations"] ?? -1) === 0
      && (counters["live_clod_stream_active_root_pages"] ?? 0) > 0
      && (counters["heightfield_tiles_pending"] ?? 0) === 0
      && (counters["heightfield_tiles_inflight"] ?? 0) === 0;
  }, undefined, { timeout: CONVERGENCE_TIMEOUT_MS, polling: 500 });
  await settlePage(page, 90, SETTLE_TIMEOUT_MS);
}

async function installBoundaryProps(page: Page): Promise<void> {
  await page.evaluate((placements) => {
    const replace = window.__drusnielClod?.replaceTerrainAnchoredCustomProps;
    if (!replace) throw new Error("replaceTerrainAnchoredCustomProps hook is unavailable");
    const scene = replace(placements);
    if (!scene || scene.instances.length !== placements.length) {
      throw new Error(`expected ${placements.length} boundary props, got ${scene?.instances.length ?? 0}`);
    }
  }, PLACEMENTS);
  await settlePage(page, 30, SETTLE_TIMEOUT_MS);
}

async function collectEvidence(page: Page): Promise<BoundaryPropClodEvidence> {
  return page.evaluate(async (offsetM) => {
    const hooks = window.__drusnielClod;
    if (!hooks?.probeStreamRootHeights) throw new Error("probeStreamRootHeights hook is unavailable");
    if (!hooks.getCustomPropPlacementSnapshot) throw new Error("getCustomPropPlacementSnapshot hook is unavailable");

    const scene = hooks.getCustomPropPlacementSnapshot();
    if (!scene || scene.instances.length === 0) throw new Error("boundary prop snapshot is empty");

    const points = scene.instances.flatMap((instance) => {
      const [x, , z] = instance.position;
      return [
        { x, z },
        { x: x - offsetM, z },
        { x: x + offsetM, z },
        { x, z: z - offsetM },
        { x, z: z + offsetM },
      ];
    });
    const heights = await hooks.probeStreamRootHeights(points, 0);
    const props: BoundaryPropProbe[] = scene.instances.map((instance, index) => {
      const start = index * 5;
      const [x, propY, z] = instance.position;
      return {
        assetId: instance.assetId,
        x,
        z,
        propY,
        clodY: heights[start] ?? null,
        coverageHeights: heights.slice(start, start + 5),
      };
    });

    const counters = { ...(hooks.stats?.counters ?? {}) };
    return {
      props,
      counters,
      stream: {
        required: counters["live_clod_stream_required_pages"] ?? 0,
        pending: counters["live_clod_stream_pending_pages"] ?? -1,
        inflight: counters["live_clod_stream_inflight_batches"] ?? -1,
        failed: counters["live_clod_stream_failed_pages"] ?? -1,
        safetyPending: counters["live_clod_stream_safety_pending_pages"] ?? -1,
        safetyInflight: counters["live_clod_stream_safety_inflight_pages"] ?? -1,
        refinementPending: counters["live_clod_stream_refinement_pending_pages"] ?? -1,
        refinementInflight: counters["live_clod_stream_refinement_inflight_pages"] ?? -1,
        activeRoots: counters["live_clod_stream_active_root_pages"] ?? 0,
      },
    };
  }, COVERAGE_OFFSET_M);
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const url = clodUrl({
    scene: "infinite-islands",
    seed: 1,
    cam: `${BOUNDARY_CENTER_X},180,${BOUNDARY_CENTER_Z},1.5708,-0.55,55`,
    hud: true,
    extra: {
      acceptance: "1",
      ownershipOracle: "1",
      oceanRim: "0",
      world: "16",
      startupWorld: "4",
      infiniteStartupWorld: "4",
      farShell: "1",
      farClipmap: "1",
      farClipmapMode: "replace",
      webgpuSelection: "1",
      liveClodRootGpuMesher: "1",
      liveClodRootGpuFallback: "1",
      liveClodRootBudget: "16",
      liveClodRootApplyBudget: "4",
      liveClodRootMaxInflightBatches: "2",
      liveClodRootMaxCached: "512",
      liveClodRootMaxLevel: "1",
      customProps: "1",
      customPropsGpuRing: "0",
      water: "0",
    },
  });

  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitReady(page);
    await waitForConvergence(page);
    await installBoundaryProps(page);

    const evidence = await collectEvidence(page);
    const evaluation = evaluateBoundaryPropClodEvidence(evidence);
    const report = { url, evidence, evaluation, pageErrors };
    writeJson(resolve(OUTPUT_DIR, "report.json"), report);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "boundary-props.png") });

    if (pageErrors.length > 0) throw new Error(`page error: ${pageErrors[0]}`);
    if (!evaluation.passed) {
      throw new Error(`boundary prop/CLOD acceptance failed:\n${evaluation.failures.join("\n")}`);
    }
    console.log(
      `[boundary-prop-clod] PASS props=${evidence.props.length} ` +
      `maxDelta=${evaluation.maxVerticalDeltaM.toFixed(3)}m uncovered=${evaluation.uncoveredProbeCount}`,
    );
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
