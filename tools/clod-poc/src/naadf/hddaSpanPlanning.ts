import type { NaadfPocConfig } from "./config.js";
import type { NaadfWorldState } from "./summaryStreamer.js";
import type { HddaTraversalStats, MipSummaryNode, ResidentChunkEntry } from "./types.js";
import { estimateSafeSkipDistance, nodeRequiresRefine } from "./aadf.js";
import { sampleFarSummary } from "./farClipmap.js";
import { worldToChunkKey, worldToLocalCell } from "./keys.js";
import { sampleMipNodeAtWorld } from "./mipBuilder.js";
import { mipLevelForDistance } from "./queryHelpers.js";
import { lookupValidatedChunkIndex } from "./residentLookup.js";
import {
  HIERARCHY_BLOCK_SPAN,
  HIERARCHY_CHUNK_SPAN,
  HIERARCHY_VOXEL_SPAN,
  INF,
  QUERYABLE_STATES,
  SUN_MIN_SUMMARY_LEVEL,
} from "./hddaConstants.js";
import { HddaSpanStepper } from "./hddaStepper.js";
import type { SpanPlan, TraceBaseParams } from "./hddaTypes.js";

export function chooseSpanPlan(
  state: NaadfWorldState,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  purpose: "primary" | "sun",
): SpanPlan {
  const chunkSize = state.config.world.chunkSizeCells;
  const key = worldToChunkKey(x, z, chunkSize);
  const lookup = lookupValidatedChunkIndex(state.nearTable, state.hashFallback, state.residents, key);
  const dist = Math.hypot(x - state.cameraX, z - state.cameraZ);

  if (lookup.index >= 0) {
    const entry = state.residents[lookup.index];
    const mipChain = entry ? activeMipChain(entry) : null;
    if (mipChain) {
      const local = worldToLocalCell(x, z, key, chunkSize);
      const rawLevel = mipLevelForDistance(
        dist,
        chunkSize,
        state.config.world.voxelSizeM,
        purpose === "sun" ? state.config.query.sunLodBias : state.config.query.primaryLodBias,
      );
      const maxLevel = Math.max(0, mipChain.levels.length - 1);
      const level = purpose === "sun"
        ? Math.min(maxLevel, Math.max(SUN_MIN_SUMMARY_LEVEL, rawLevel))
        : rawLevel;
      const node = sampleMipNodeAtWorld(mipChain, local.localX, local.localZ, level, chunkSize);
      if (node) {
        return { spanDim: spanDimForNode(node, level, state.config), node, source: "resident" };
      }
    }
  }

  if (dist >= (state.config.farClipmap.rings[0]?.startM ?? INF)) {
    const far = sampleFarSummary({
      worldX: x,
      worldZ: z,
      purpose: "height",
      cameraX: state.cameraX,
      cameraZ: state.cameraZ,
      store: state.farTiles,
      config: state.config,
      source: state.source,
      forceMissingStress: state.forceMissingStress,
    });
    if (!far.unknown && y > far.maxHeight && (Math.abs(dirX) + Math.abs(dirY) + Math.abs(dirZ)) > 0) {
      return { spanDim: HIERARCHY_CHUNK_SPAN, node: null, source: "far" };
    }
  }

  return voxelPlan();
}

export function voxelPlan(): SpanPlan {
  return { spanDim: HIERARCHY_VOXEL_SPAN, node: null, source: "fallback" };
}

export function estimatePlanSkip(params: {
  state: NaadfWorldState;
  plan: SpanPlan;
  boundaryDistance: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  eps: number;
  cellSize: number;
}): number {
  const spanDistance = params.plan.spanDim * params.cellSize;
  if (
    params.plan.spanDim > HIERARCHY_VOXEL_SPAN
    && params.plan.node
    && params.state.config.traversal.hddaUseDirectionalBounds
  ) {
    return estimateSafeSkipDistance({
      node: params.plan.node,
      rayDirX: params.dirX,
      rayDirY: params.dirY,
      rayDirZ: params.dirZ,
      cellSizeM: spanDistance,
      nextCellBoundaryDistanceM: params.boundaryDistance,
      epsilonM: params.eps,
      config: params.state.config,
    });
  }
  return Math.max(params.eps, Math.min(params.boundaryDistance, spanDistance));
}

export function updateTraversalStats(stats: HddaTraversalStats, plan: SpanPlan, skip: number, cellSize: number): void {
  if (plan.spanDim >= HIERARCHY_CHUNK_SPAN && skip > cellSize * 1.01) {
    stats.chunkSkips++;
  } else if (plan.spanDim >= HIERARCHY_BLOCK_SPAN && skip > cellSize * 1.01) {
    stats.blockSkips++;
  } else {
    stats.voxelSteps++;
  }
}

export function isBudgetExceeded(config: NaadfPocConfig, stats: HddaTraversalStats): boolean {
  return stats.chunkSkips > config.traversal.hddaMaxChunkSteps
    || stats.blockSkips > config.traversal.hddaMaxBlockSteps
    || stats.voxelSteps > config.traversal.hddaMaxVoxelSteps;
}

export function advanceStepper(
  stepper: HddaSpanStepper,
  params: Pick<TraceBaseParams, "originX" | "originY" | "originZ" | "maxDistanceM">,
  dirX: number,
  dirY: number,
  dirZ: number,
  skip: number,
  boundaryDistance: number,
  eps: number,
  cellSize: number,
): HddaSpanStepper {
  if (skip >= boundaryDistance - eps) {
    return stepper.stepSpan(eps);
  }
  return stepper.reinitAtT({
    originX: params.originX,
    originY: params.originY,
    originZ: params.originZ,
    dirX,
    dirY,
    dirZ,
    t: Math.min(params.maxDistanceM, stepper.t + Math.max(eps, skip)),
    spanDim: stepper.spanDim,
    cellSizeM: cellSize,
  });
}

export function recordHddaMetrics(state: NaadfWorldState, stats: HddaTraversalStats): void {
  state.metrics.hddaSpanSteps += stats.spanSteps;
  state.metrics.hddaChunkSkips += stats.chunkSkips;
  state.metrics.hddaBlockSkips += stats.blockSkips;
  state.metrics.hddaVoxelSteps += stats.voxelSteps;
}

function activeMipChain(entry: ResidentChunkEntry) {
  if (!QUERYABLE_STATES.has(entry.state)) return null;
  return entry.mipChain;
}

function spanDimForNode(node: MipSummaryNode, mipLevel: number, config: NaadfPocConfig): number {
  if (nodeRequiresRefine(node, config)) return HIERARCHY_VOXEL_SPAN;
  const rawSpan = Math.max(1, 1 << Math.max(0, mipLevel));
  if (rawSpan >= HIERARCHY_CHUNK_SPAN) return HIERARCHY_CHUNK_SPAN;
  if (rawSpan >= HIERARCHY_BLOCK_SPAN) return HIERARCHY_BLOCK_SPAN;
  return HIERARCHY_VOXEL_SPAN;
}
