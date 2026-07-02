import { sunNodeBlocksRay } from "./aadf.js";
import { aadfSkipOccurred } from "./queryHelpers.js";
import type { RayTraceResult, SunVisibilityResult } from "./types.js";
import { HIERARCHY_VOXEL_SPAN } from "./hddaConstants.js";
import {
  createTraversalStats,
  emptyRayResult,
  emptySunResult,
  normalizeRay,
} from "./hddaResults.js";
import {
  advanceStepper,
  chooseSpanPlan,
  estimatePlanSkip,
  isBudgetExceeded,
  recordHddaMetrics,
  updateTraversalStats,
  voxelPlan,
} from "./hddaSpanPlanning.js";
import { HddaSpanStepper } from "./hddaStepper.js";
import type { SunTraceBaseParams, TraceBaseParams } from "./hddaTypes.js";

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
