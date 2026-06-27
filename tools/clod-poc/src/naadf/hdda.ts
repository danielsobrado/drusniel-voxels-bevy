import type { NaadfPocConfig } from "./config.js";
import type { NaadfWorldState } from "./summaryStreamer.js";
import type {
  HddaCompareResult,
  HddaMismatchReason,
  HddaTraversalStats,
  MipSummaryNode,
  RayTraceResult,
  ResidentChunkEntry,
  SunVisibilityResult,
  TerrainQueryResult,
} from "./types.js";
import { estimateSafeSkipDistance, nodeRequiresRefine, sunNodeBlocksRay } from "./aadf.js";
import { sampleFarSummary } from "./farClipmap.js";
import { worldToChunkKey, worldToLocalCell } from "./keys.js";
import { sampleMipNodeAtWorld } from "./mipBuilder.js";
import { aadfSkipOccurred, mipLevelForDistance } from "./queryHelpers.js";
import { lookupValidatedChunkIndex } from "./residentLookup.js";

const INF = Number.POSITIVE_INFINITY;
const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;
const HIERARCHY_CHUNK_SPAN = 16;
const HIERARCHY_BLOCK_SPAN = 4;
const HIERARCHY_VOXEL_SPAN = 1;
const SUN_MIN_SUMMARY_LEVEL = 2;

const QUERYABLE_STATES: ReadonlySet<ResidentChunkEntry["state"]> = new Set([
  "ready",
  "stale",
  "building",
]);

type QueryPurpose = "render" | "shadow" | "canopy" | "material" | "debug";

type QueryHeightFn = (params: {
  state: NaadfWorldState;
  worldX: number;
  worldZ: number;
  purpose: QueryPurpose;
}) => TerrainQueryResult;

type TraceBaseParams = {
  state: NaadfWorldState;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  maxDistanceM: number;
  queryHeight: QueryHeightFn;
};

type SunTraceBaseParams = {
  state: NaadfWorldState;
  worldX: number;
  worldY: number;
  worldZ: number;
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  maxDistanceM: number;
  queryHeight: QueryHeightFn;
};

type SpanPlan = Readonly<{
  spanDim: number;
  node: MipSummaryNode | null;
  source: "resident" | "far" | "fallback";
}>;

export class HddaSpanStepper {
  readonly cellX: number;
  readonly cellY: number;
  readonly cellZ: number;
  readonly stepX: number;
  readonly stepY: number;
  readonly stepZ: number;
  readonly t: number;
  readonly tMax: number;
  readonly nextX: number;
  readonly nextY: number;
  readonly nextZ: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly spanDim: number;

  private constructor(params: {
    cellX: number;
    cellY: number;
    cellZ: number;
    stepX: number;
    stepY: number;
    stepZ: number;
    t: number;
    tMax: number;
    nextX: number;
    nextY: number;
    nextZ: number;
    deltaX: number;
    deltaY: number;
    deltaZ: number;
    spanDim: number;
  }) {
    this.cellX = params.cellX;
    this.cellY = params.cellY;
    this.cellZ = params.cellZ;
    this.stepX = params.stepX;
    this.stepY = params.stepY;
    this.stepZ = params.stepZ;
    this.t = params.t;
    this.tMax = params.tMax;
    this.nextX = params.nextX;
    this.nextY = params.nextY;
    this.nextZ = params.nextZ;
    this.deltaX = params.deltaX;
    this.deltaY = params.deltaY;
    this.deltaZ = params.deltaZ;
    this.spanDim = params.spanDim;
  }

  static init(params: {
    originX: number;
    originY: number;
    originZ: number;
    dirX: number;
    dirY: number;
    dirZ: number;
    t0: number;
    tMax: number;
    spanDim: number;
    cellSizeM: number;
  }): HddaSpanStepper {
    const spanDim = Math.max(1, Math.floor(params.spanDim));
    const posX = params.originX + params.dirX * params.t0;
    const posY = params.originY + params.dirY * params.t0;
    const posZ = params.originZ + params.dirZ * params.t0;
    const voxelX = voxelIndexForPosition(posX, params.dirX, params.cellSizeM);
    const voxelY = voxelIndexForPosition(posY, params.dirY, params.cellSizeM);
    const voxelZ = voxelIndexForPosition(posZ, params.dirZ, params.cellSizeM);
    const cellX = alignVoxel(voxelX, spanDim);
    const cellY = alignVoxel(voxelY, spanDim);
    const cellZ = alignVoxel(voxelZ, spanDim);
    const stepX = axisStep(params.dirX);
    const stepY = axisStep(params.dirY);
    const stepZ = axisStep(params.dirZ);
    const deltaX = axisDelta(params.dirX, params.cellSizeM);
    const deltaY = axisDelta(params.dirY, params.cellSizeM);
    const deltaZ = axisDelta(params.dirZ, params.cellSizeM);

    return new HddaSpanStepper({
      cellX,
      cellY,
      cellZ,
      stepX,
      stepY,
      stepZ,
      t: params.t0,
      tMax: params.tMax,
      nextX: nextBoundaryT(posX, params.dirX, params.t0, cellX, spanDim, params.cellSizeM),
      nextY: nextBoundaryT(posY, params.dirY, params.t0, cellY, spanDim, params.cellSizeM),
      nextZ: nextBoundaryT(posZ, params.dirZ, params.t0, cellZ, spanDim, params.cellSizeM),
      deltaX,
      deltaY,
      deltaZ,
      spanDim,
    });
  }

  reinitAtT(params: {
    originX: number;
    originY: number;
    originZ: number;
    dirX: number;
    dirY: number;
    dirZ: number;
    t: number;
    spanDim: number;
    cellSizeM: number;
  }): HddaSpanStepper {
    return HddaSpanStepper.init({
      originX: params.originX,
      originY: params.originY,
      originZ: params.originZ,
      dirX: params.dirX,
      dirY: params.dirY,
      dirZ: params.dirZ,
      t0: Math.max(this.t, params.t),
      tMax: this.tMax,
      spanDim: params.spanDim,
      cellSizeM: params.cellSizeM,
    });
  }

  nextAxis(): number {
    if (this.nextX <= this.nextY && this.nextX <= this.nextZ) return AXIS_X;
    if (this.nextY <= this.nextZ) return AXIS_Y;
    return AXIS_Z;
  }

  distanceToNextBoundary(epsilonM: number): number {
    const next = Math.min(this.nextX, this.nextY, this.nextZ, this.tMax);
    if (!Number.isFinite(next)) return Math.max(epsilonM, this.tMax - this.t);
    return Math.max(epsilonM, next - this.t);
  }

  stepSpan(epsilonM: number): HddaSpanStepper {
    const axis = this.nextAxis();
    const nextT = Math.min(this.tMax, Math.max(this.t + epsilonM, axis === AXIS_X ? this.nextX : axis === AXIS_Y ? this.nextY : this.nextZ));
    return new HddaSpanStepper({
      cellX: axis === AXIS_X ? this.cellX + this.spanDim * this.stepX : this.cellX,
      cellY: axis === AXIS_Y ? this.cellY + this.spanDim * this.stepY : this.cellY,
      cellZ: axis === AXIS_Z ? this.cellZ + this.spanDim * this.stepZ : this.cellZ,
      stepX: this.stepX,
      stepY: this.stepY,
      stepZ: this.stepZ,
      t: nextT,
      tMax: this.tMax,
      nextX: axis === AXIS_X ? this.nextX + this.spanDim * this.deltaX : this.nextX,
      nextY: axis === AXIS_Y ? this.nextY + this.spanDim * this.deltaY : this.nextY,
      nextZ: axis === AXIS_Z ? this.nextZ + this.spanDim * this.deltaZ : this.nextZ,
      deltaX: this.deltaX,
      deltaY: this.deltaY,
      deltaZ: this.deltaZ,
      spanDim: this.spanDim,
    });
  }
}

export function tracePrimaryDebugRayHdda(params: TraceBaseParams): RayTraceResult {
  const normalized = normalizeRay(params.dirX, params.dirY, params.dirZ);
  if (!normalized) return emptyRayResult("hdda");

  const { state, maxDistanceM, queryHeight } = params;
  const { dirX, dirY, dirZ } = normalized;
  const cellSize = state.config.world.voxelSizeM;
  const eps = Math.max(state.config.query.epsilonM, 1e-6);
  const maxSteps = Math.min(state.config.query.maxStepsPrimary, state.config.traversal.hddaMaxVoxelSteps);
  let stepper = HddaSpanStepper.init({
    originX: params.originX,
    originY: params.originY,
    originZ: params.originZ,
    dirX,
    dirY,
    dirZ,
    t0: 0,
    tMax: maxDistanceM,
    spanDim: HIERARCHY_VOXEL_SPAN,
    cellSizeM: cellSize,
  });
  let steps = 0;
  let aadfSkips = 0;
  let nearTableHits = 0;
  let hashFallbackHits = 0;
  let farClipmapHits = 0;
  let missingSamples = 0;
  let budgetExceeded = false;
  const stats = createTraversalStats();

  state.metrics.hddaRays++;

  while (stepper.t < maxDistanceM && steps < maxSteps) {
    steps++;
    stats.spanSteps++;
    const x = params.originX + dirX * stepper.t;
    const y = params.originY + dirY * stepper.t;
    const z = params.originZ + dirZ * stepper.t;
    const q = queryHeight({ state, worldX: x, worldZ: z, purpose: "debug" });
    if (q.nearTableHit) nearTableHits++;
    if (q.hashFallbackHit) hashFallbackHits++;
    if (q.farClipmapHit) farClipmapHits++;
    if (q.unknown || q.missingSample) missingSamples++;

    if (y <= q.height) {
      recordHddaMetrics(state, stats);
      state.metrics.primarySteps.add(steps);
      state.metrics.aadfSkips += aadfSkips;
      return {
        hit: true,
        unknown: q.unknown,
        hitX: x,
        hitY: q.height,
        hitZ: z,
        material: q.material,
        steps,
        aadfSkips,
        nearTableHits,
        hashFallbackHits,
        farClipmapHits,
        missingSamples,
        traversalMode: "hdda",
        hdda: stats,
      };
    }

    let plan = chooseSpanPlan(state, x, y, z, dirX, dirY, dirZ, "primary");
    if (plan.node && y <= plan.node.maxHeight + eps) {
      plan = voxelPlan();
    }
    if (stepper.spanDim !== plan.spanDim) {
      stepper = stepper.reinitAtT({
        originX: params.originX,
        originY: params.originY,
        originZ: params.originZ,
        dirX,
        dirY,
        dirZ,
        t: stepper.t,
        spanDim: plan.spanDim,
        cellSizeM: cellSize,
      });
    }

    const boundaryDistance = stepper.distanceToNextBoundary(eps);
    let skip = estimatePlanSkip({ state, plan, boundaryDistance, dirX, dirY, dirZ, eps, cellSize });
    if (plan.node && dirY < -1e-6) {
      const verticalLimit = (y - plan.node.maxHeight) / -dirY;
      if (Number.isFinite(verticalLimit) && verticalLimit > eps) {
        skip = Math.min(skip, verticalLimit);
      }
    }
    if (aadfSkipOccurred(skip, cellSize)) aadfSkips++;
    updateTraversalStats(stats, plan, skip, cellSize);
    if (isBudgetExceeded(state.config, stats)) {
      budgetExceeded = true;
      break;
    }
    stepper = advanceStepper(stepper, params, dirX, dirY, dirZ, skip, boundaryDistance, eps, cellSize);
  }

  recordHddaMetrics(state, stats);
  state.metrics.primarySteps.add(steps);
  state.metrics.aadfSkips += aadfSkips;
  const missX = params.originX + dirX * Math.min(stepper.t, maxDistanceM);
  const missY = params.originY + dirY * Math.min(stepper.t, maxDistanceM);
  const missZ = params.originZ + dirZ * Math.min(stepper.t, maxDistanceM);
  return {
    hit: false,
    unknown: missingSamples > 0 || budgetExceeded || steps >= maxSteps,
    hitX: missX,
    hitY: missY,
    hitZ: missZ,
    material: 0,
    steps,
    aadfSkips,
    nearTableHits,
    hashFallbackHits,
    farClipmapHits,
    missingSamples,
    traversalMode: "hdda",
    hdda: stats,
  };
}

export function traceSunVisibilityHdda(params: SunTraceBaseParams): SunVisibilityResult {
  const normalized = normalizeRay(params.sunDirX, params.sunDirY, params.sunDirZ);
  if (!normalized) return emptySunResult("hdda");

  const { state, maxDistanceM, queryHeight } = params;
  const { dirX, dirY, dirZ } = normalized;
  const cellSize = state.config.world.voxelSizeM;
  const eps = Math.max(state.config.query.epsilonM, 1e-6);
  const maxSteps = Math.min(state.config.query.maxStepsSun, state.config.traversal.hddaMaxVoxelSteps);
  let stepper = HddaSpanStepper.init({
    originX: params.worldX,
    originY: params.worldY,
    originZ: params.worldZ,
    dirX,
    dirY,
    dirZ,
    t0: 0,
    tMax: maxDistanceM,
    spanDim: HIERARCHY_VOXEL_SPAN,
    cellSizeM: cellSize,
  });
  let steps = 0;
  let aadfSkips = 0;
  let nearTableHits = 0;
  let hashFallbackHits = 0;
  let farClipmapHits = 0;
  let missingSamples = 0;
  let budgetExceeded = false;
  const stats = createTraversalStats();

  state.metrics.hddaRays++;

  while (stepper.t < maxDistanceM && steps < maxSteps) {
    steps++;
    stats.spanSteps++;
    const x = params.worldX + dirX * stepper.t;
    const y = params.worldY + dirY * stepper.t;
    const z = params.worldZ + dirZ * stepper.t;
    const q = queryHeight({ state, worldX: x, worldZ: z, purpose: "shadow" });
    state.metrics.shadowProxySamples++;
    if (q.nearTableHit) nearTableHits++;
    if (q.hashFallbackHit) hashFallbackHits++;
    if (q.farClipmapHit) farClipmapHits++;

    if (q.unknown) {
      missingSamples++;
      if (state.config.query.unknownCountsAsBlockedForSun) {
        state.metrics.unknownSunSamples++;
        recordHddaMetrics(state, stats);
        state.metrics.sunSteps.add(steps);
        state.metrics.aadfSkips += aadfSkips;
        return { visible: false, unknown: true, blocked: true, steps, aadfSkips, nearTableHits, hashFallbackHits, farClipmapHits, missingSamples, traversalMode: "hdda", hdda: stats };
      }
    }

    if (y <= q.height) {
      recordHddaMetrics(state, stats);
      state.metrics.sunSteps.add(steps);
      state.metrics.aadfSkips += aadfSkips;
      return { visible: false, unknown: false, blocked: true, steps, aadfSkips, nearTableHits, hashFallbackHits, farClipmapHits, missingSamples, traversalMode: "hdda", hdda: stats };
    }

    const plan = chooseSpanPlan(state, x, y, z, dirX, dirY, dirZ, "sun");
    if (plan.node) {
      const sunResult = sunNodeBlocksRay(plan.node, y, state.config);
      if (sunResult === "blocked") {
        recordHddaMetrics(state, stats);
        state.metrics.sunSteps.add(steps);
        state.metrics.aadfSkips += aadfSkips;
        return { visible: false, unknown: false, blocked: true, steps, aadfSkips, nearTableHits, hashFallbackHits, farClipmapHits, missingSamples, traversalMode: "hdda", hdda: stats };
      }
    }
    if (stepper.spanDim !== plan.spanDim) {
      stepper = HddaSpanStepper.init({
        originX: params.worldX,
        originY: params.worldY,
        originZ: params.worldZ,
        dirX,
        dirY,
        dirZ,
        t0: stepper.t,
        tMax: maxDistanceM,
        spanDim: plan.spanDim,
        cellSizeM: cellSize,
      });
    }

    const boundaryDistance = stepper.distanceToNextBoundary(eps);
    const skip = estimatePlanSkip({ state, plan, boundaryDistance, dirX, dirY, dirZ, eps, cellSize });
    if (aadfSkipOccurred(skip, cellSize)) aadfSkips++;
    updateTraversalStats(stats, plan, skip, cellSize);
    if (isBudgetExceeded(state.config, stats)) {
      budgetExceeded = true;
      break;
    }
    stepper = advanceStepper(
      stepper,
      {
        originX: params.worldX,
        originY: params.worldY,
        originZ: params.worldZ,
        maxDistanceM,
      },
      dirX,
      dirY,
      dirZ,
      skip,
      boundaryDistance,
      eps,
      cellSize,
    );
  }

  recordHddaMetrics(state, stats);
  state.metrics.sunSteps.add(steps);
  state.metrics.aadfSkips += aadfSkips;
  return { visible: true, unknown: missingSamples > 0 || budgetExceeded || steps >= maxSteps, blocked: false, steps, aadfSkips, nearTableHits, hashFallbackHits, farClipmapHits, missingSamples, traversalMode: "hdda", hdda: stats };
}

export function compareRayResults(
  dense: RayTraceResult,
  hdda: RayTraceResult,
  origin: { x: number; y: number; z: number },
  config: NaadfPocConfig,
): HddaCompareResult {
  const denseDist = hitDistance(dense, origin);
  const hddaDist = hitDistance(hdda, origin);
  const distanceDeltaM = Math.abs(denseDist - hddaDist);
  const mismatchReason = rayMismatchReason(dense, hdda, distanceDeltaM, config.traversal.compareDistanceEpsilonM);
  return {
    mismatchReason,
    denseSteps: dense.steps,
    hddaSteps: hdda.steps,
    denseHit: dense.hit,
    hddaHit: hdda.hit,
    denseMaterial: dense.material,
    hddaMaterial: hdda.material,
    distanceDeltaM,
  };
}

export function compareSunResults(dense: SunVisibilityResult, hdda: SunVisibilityResult): HddaCompareResult {
  let mismatchReason: HddaMismatchReason = "none";
  if (dense.blocked !== hdda.blocked || dense.visible !== hdda.visible) mismatchReason = "hit_miss_mismatch";
  else if (dense.unknown !== hdda.unknown) mismatchReason = "missing_chunk";
  return {
    mismatchReason,
    denseSteps: dense.steps,
    hddaSteps: hdda.steps,
    denseHit: dense.blocked,
    hddaHit: hdda.blocked,
    denseMaterial: 0,
    hddaMaterial: 0,
    distanceDeltaM: 0,
  };
}

function activeMipChain(entry: ResidentChunkEntry) {
  if (!QUERYABLE_STATES.has(entry.state)) return null;
  return entry.mipChain;
}

function chooseSpanPlan(
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

function voxelPlan(): SpanPlan {
  return { spanDim: HIERARCHY_VOXEL_SPAN, node: null, source: "fallback" };
}

function spanDimForNode(node: MipSummaryNode, mipLevel: number, config: NaadfPocConfig): number {
  if (nodeRequiresRefine(node, config)) return HIERARCHY_VOXEL_SPAN;
  const rawSpan = Math.max(1, 1 << Math.max(0, mipLevel));
  if (rawSpan >= HIERARCHY_CHUNK_SPAN) return HIERARCHY_CHUNK_SPAN;
  if (rawSpan >= HIERARCHY_BLOCK_SPAN) return HIERARCHY_BLOCK_SPAN;
  return HIERARCHY_VOXEL_SPAN;
}

function estimatePlanSkip(params: {
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

function updateTraversalStats(stats: HddaTraversalStats, plan: SpanPlan, skip: number, cellSize: number): void {
  if (plan.spanDim >= HIERARCHY_CHUNK_SPAN && skip > cellSize * 1.01) {
    stats.chunkSkips++;
  } else if (plan.spanDim >= HIERARCHY_BLOCK_SPAN && skip > cellSize * 1.01) {
    stats.blockSkips++;
  } else {
    stats.voxelSteps++;
  }
}

function isBudgetExceeded(config: NaadfPocConfig, stats: HddaTraversalStats): boolean {
  return stats.chunkSkips > config.traversal.hddaMaxChunkSteps
    || stats.blockSkips > config.traversal.hddaMaxBlockSteps
    || stats.voxelSteps > config.traversal.hddaMaxVoxelSteps;
}

function advanceStepper(
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

function recordHddaMetrics(state: NaadfWorldState, stats: HddaTraversalStats): void {
  state.metrics.hddaSpanSteps += stats.spanSteps;
  state.metrics.hddaChunkSkips += stats.chunkSkips;
  state.metrics.hddaBlockSkips += stats.blockSkips;
  state.metrics.hddaVoxelSteps += stats.voxelSteps;
}

function createTraversalStats(): HddaTraversalStats {
  return { spanSteps: 0, chunkSkips: 0, blockSkips: 0, voxelSteps: 0 };
}

function normalizeRay(dirX: number, dirY: number, dirZ: number): { dirX: number; dirY: number; dirZ: number } | null {
  const len = Math.hypot(dirX, dirY, dirZ);
  if (len < 1e-10) return null;
  return { dirX: dirX / len, dirY: dirY / len, dirZ: dirZ / len };
}

function emptyRayResult(traversalMode: "hdda"): RayTraceResult {
  return {
    hit: false,
    unknown: true,
    hitX: 0,
    hitY: 0,
    hitZ: 0,
    material: 0,
    steps: 0,
    aadfSkips: 0,
    nearTableHits: 0,
    hashFallbackHits: 0,
    farClipmapHits: 0,
    missingSamples: 1,
    traversalMode,
    hdda: createTraversalStats(),
  };
}

function emptySunResult(traversalMode: "hdda"): SunVisibilityResult {
  return { visible: true, unknown: false, blocked: false, steps: 0, aadfSkips: 0, nearTableHits: 0, hashFallbackHits: 0, farClipmapHits: 0, missingSamples: 0, traversalMode, hdda: createTraversalStats() };
}

function hitDistance(result: RayTraceResult, origin: { x: number; y: number; z: number }): number {
  if (!result.hit) return INF;
  return Math.hypot(result.hitX - origin.x, result.hitY - origin.y, result.hitZ - origin.z);
}

function rayMismatchReason(
  dense: RayTraceResult,
  hdda: RayTraceResult,
  distanceDeltaM: number,
  epsilonM: number,
): HddaMismatchReason {
  if (dense.hit !== hdda.hit) return "hit_miss_mismatch";
  if (dense.unknown !== hdda.unknown) return "missing_chunk";
  if (!dense.hit && !hdda.hit) return "none";
  if (dense.material !== hdda.material) return "material_mismatch";
  if (distanceDeltaM > epsilonM) return "distance_mismatch";
  return "none";
}

function voxelIndexForPosition(position: number, dir: number, cellSizeM: number): number {
  const scaled = position / cellSizeM;
  if (dir < 0 && Math.abs(scaled - Math.round(scaled)) < 1e-8) {
    return Math.round(scaled) - 1;
  }
  return Math.floor(scaled);
}

function alignVoxel(voxel: number, spanDim: number): number {
  return Math.floor(voxel / spanDim) * spanDim;
}

function axisStep(dir: number): number {
  if (dir > 1e-10) return 1;
  if (dir < -1e-10) return -1;
  return 0;
}

function axisDelta(dir: number, cellSizeM: number): number {
  return Math.abs(dir) > 1e-10 ? cellSizeM / Math.abs(dir) : INF;
}

function nextBoundaryT(
  position: number,
  dir: number,
  t: number,
  cell: number,
  spanDim: number,
  cellSizeM: number,
): number {
  if (Math.abs(dir) <= 1e-10) return INF;
  const boundaryVoxel = dir > 0 ? cell + spanDim : cell;
  const boundary = boundaryVoxel * cellSizeM;
  const result = t + (boundary - position) / dir;
  if (!Number.isFinite(result)) return INF;
  return result <= t ? t + axisDelta(dir, cellSizeM) * spanDim : result;
}
