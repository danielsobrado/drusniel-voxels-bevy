// Canopy tile build worker: runs buildCanopySummaryTile off the main thread.
//
// Exactness contract: the main-thread canopy sampler is createBlendedTerrainSampler(summary,
// farRadius) whose analytic fallback is WorldSource.sampleHeight = surfaceHeightCore(x, z,
// metadata.terrain). This worker rebuilds the identical sampler from the transferred summary
// heights and the same terrain field config, and the tree distribution from the same
// config + seed, so worker-built tiles match main-thread tiles bit for bit. NAADF scenes are
// gated out client-side (the NAADF coverage merge is main-thread state).

import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { surfaceHeightCore } from "../gpu/terrain_field_core.js";
import { buildCanopySummaryTile } from "./canopy_summary_builder.js";
import {
  createAnalyticTerrainSampler,
  createSummaryTerrainSampler,
  type CanopyTerrainSampler,
} from "./canopy_terrain_sampler.js";
import { createTreeDistribution, type TreeDistribution } from "./deterministic_tree_distribution.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import {
  packCanopyTile,
  type CanopyWorkerConfigureRequest,
  type CanopyWorkerRequest,
  type CanopyWorkerResponse,
} from "./canopy_worker_protocol.js";

const ctx = self as unknown as {
  postMessage: (message: CanopyWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<CanopyWorkerRequest>) => void) | null;
};

interface WorkerState {
  configId: number;
  config: CanopyShellConfig;
  terrainSampler: CanopyTerrainSampler;
  treeDistribution: TreeDistribution;
}

let state: WorkerState | null = null;

function samplerFromConfigure(request: CanopyWorkerConfigureRequest): CanopyTerrainSampler {
  const terrainConfig = request.terrainFieldConfig;
  const analyticHeight = terrainConfig
    ? (x: number, z: number) => surfaceHeightCore(x, z, terrainConfig)
    : (x: number, z: number) => surfaceHeightCore(x, z);
  if (!request.summary) {
    return terrainConfig
      ? createSummaryFreeAnalyticSampler(analyticHeight)
      : createAnalyticTerrainSampler();
  }
  // The summary height path reads only res/worldSize/heightMin/heightMax plus the analytic
  // sampler; the remaining TerrainSummaryField arrays are unused stubs here.
  const empty = new Float32Array(0);
  const field: TerrainSummaryField = {
    res: request.summary.res,
    worldSize: request.summary.worldSize,
    farReduceFactor: request.summary.farReduceFactor,
    heightMin: request.summary.heightMin,
    heightMax: request.summary.heightMax,
    normalX: empty,
    normalY: empty,
    normalZ: empty,
    coverage: empty,
    analyticHeightSampler: analyticHeight,
  };
  return createSummaryTerrainSampler(field, request.farRadius);
}

/** Analytic sampler with an explicit terrain config (mirrors createAnalyticTerrainSampler). */
function createSummaryFreeAnalyticSampler(heightAt: (x: number, z: number) => number): CanopyTerrainSampler {
  const waterLevel = 0.5;
  const estimateNormal = (x: number, z: number, eps = 2) => {
    const hL = heightAt(x - eps, z);
    const hR = heightAt(x + eps, z);
    const hD = heightAt(x, z - eps);
    const hU = heightAt(x, z + eps);
    const nx = (hL - hR) / (2 * eps);
    const nz = (hD - hU) / (2 * eps);
    const len = Math.hypot(nx, 1, nz) || 1;
    return { x: nx / len, y: 1 / len, z: nz / len };
  };
  return {
    sample(x: number, z: number) {
      const height = heightAt(x, z);
      const normal = estimateNormal(x, z);
      return {
        height,
        normal,
        slope: Math.max(0, Math.min(1, 1 - normal.y)),
        materialHint: 0,
        water: height < waterLevel,
      };
    },
  };
}

function handleConfigure(request: CanopyWorkerConfigureRequest): void {
  state = {
    configId: request.configId,
    config: request.config,
    terrainSampler: samplerFromConfigure(request),
    treeDistribution: createTreeDistribution(request.config.treeDistribution, request.config.seed),
  };
}

function handleBuild(request: Extract<CanopyWorkerRequest, { type: "build" }>): void {
  if (!state || state.configId !== request.configId) {
    // Stale batch from before a reconfigure; report empty so the client re-queues the tiles.
    ctx.postMessage({ type: "built", requestId: request.requestId, configId: request.configId, tiles: [], buildMs: 0 });
    return;
  }
  const t0 = performance.now();
  const built = request.tiles.map((tile) => packCanopyTile(buildCanopySummaryTile({
    key: tile.key,
    originX: tile.originX,
    originZ: tile.originZ,
    cellSizeM: tile.cellSizeM,
    resolution: tile.resolution,
    config: state!.config,
    terrainSampler: state!.terrainSampler,
    treeDistribution: state!.treeDistribution,
    revision: tile.revision,
  })));
  const transfer = built.map((tile) => tile.cells.buffer);
  ctx.postMessage({
    type: "built",
    requestId: request.requestId,
    configId: request.configId,
    tiles: built,
    buildMs: performance.now() - t0,
  }, transfer);
}

ctx.onmessage = (event: MessageEvent<CanopyWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "configure") handleConfigure(request);
    else handleBuild(request);
  } catch (error) {
    ctx.postMessage({
      type: "error",
      requestId: request.type === "build" ? request.requestId : null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
