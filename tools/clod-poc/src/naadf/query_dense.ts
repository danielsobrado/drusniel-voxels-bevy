import type { RayTraceResult, SunVisibilityResult, TerrainQueryResult } from "./types.js";
import type { NaadfWorldState } from "./summaryStreamer.js";
import { NaadfMetricsCollector } from "./metrics.js";
import type { LocalCounters, PrimaryDenseParams, PrimaryProbe, QueryPurpose, SunDenseParams } from "./query_types.js";
import { ORACLE_REFINE_STEPS } from "./query_constants.js";
import { recordLocalCounters } from "./query_helpers_private.js";

type QueryHeightFn = (params: { state: NaadfWorldState; worldX: number; worldZ: number; purpose: QueryPurpose }) => TerrainQueryResult;

export function tracePrimaryDebugRayDense(
  params: PrimaryDenseParams,
  queryHeight: QueryHeightFn,
): RayTraceResult {
  const { state, maxDistanceM } = params;
  let { originX, originY, originZ, dirX, dirY, dirZ } = params;

  const len = Math.hypot(dirX, dirY, dirZ);
  if (len < 1e-10) return emptyRayResult("dense");
  dirX /= len;
  dirY /= len;
  dirZ /= len;

  const maxSteps = state.config.query.maxStepsPrimary;
  const stepDistance = Math.max(state.config.query.epsilonM, state.config.world.voxelSizeM);
  const counters = createLocalCounters();
  let traveled = 0;
  let steps = 0;
  let probe = samplePrimaryProbe(state, counters, originX, originY, originZ, "debug", queryHeight);

  while (traveled < maxDistanceM && steps < maxSteps) {
    steps++;
    if (probe.y <= probe.terrain.height) {
      state.metrics.primarySteps.add(steps);
      return primaryHitResult(probe, steps, counters, "dense");
    }

    const nextTravel = Math.min(maxDistanceM, traveled + stepDistance);
    const segmentDistance = nextTravel - traveled;
    const nextProbe = samplePrimaryProbe(
      state,
      counters,
      probe.x + dirX * segmentDistance,
      probe.y + dirY * segmentDistance,
      probe.z + dirZ * segmentDistance,
      "debug",
      queryHeight,
    );

    if (nextProbe.y <= nextProbe.terrain.height) {
      const hit = refinePrimaryCrossing(state, counters, probe, nextProbe, "debug", queryHeight);
      state.metrics.primarySteps.add(steps);
      return primaryHitResult(hit, steps, counters, "dense");
    }

    traveled = nextTravel;
    probe = nextProbe;
  }

  state.metrics.primarySteps.add(steps);
  return {
    hit: false,
    unknown: counters.missingSamples > 0,
    hitX: probe.x,
    hitY: probe.y,
    hitZ: probe.z,
    material: 0,
    steps,
    aadfSkips: 0,
    nearTableHits: counters.nearTableHits,
    hashFallbackHits: counters.hashFallbackHits,
    farClipmapHits: counters.farClipmapHits,
    missingSamples: counters.missingSamples,
    traversalMode: "dense",
  };
}

export function traceSunVisibilityDense(
  params: SunDenseParams,
  queryHeight: QueryHeightFn,
): SunVisibilityResult {
  const { state, worldX, worldY, worldZ, maxDistanceM } = params;
  let { sunDirX, sunDirY, sunDirZ } = params;

  const len = Math.hypot(sunDirX, sunDirY, sunDirZ);
  if (len < 1e-10) {
    return { visible: true, unknown: false, blocked: false, steps: 0, aadfSkips: 0, nearTableHits: 0, hashFallbackHits: 0, farClipmapHits: 0, missingSamples: 0, traversalMode: "dense" };
  }
  sunDirX /= len;
  sunDirY /= len;
  sunDirZ /= len;

  const maxSteps = state.config.query.maxStepsSun;
  const stepDistance = Math.max(state.config.query.epsilonM, state.config.world.voxelSizeM);
  const counters = createLocalCounters();
  let traveled = 0;
  let steps = 0;
  let probe = samplePrimaryProbe(state, counters, worldX, worldY, worldZ, "shadow", queryHeight);

  while (traveled < maxDistanceM && steps < maxSteps) {
    steps++;
    state.metrics.shadowProxySamples++;

    if (probe.terrain.unknown) {
      if (state.config.query.unknownCountsAsBlockedForSun) {
        state.metrics.unknownSunSamples++;
        state.metrics.sunSteps.add(steps);
        return sunBlockedResult(true, steps, counters, "dense");
      }
    }

    if (probe.y <= probe.terrain.height) {
      state.metrics.sunSteps.add(steps);
      return sunBlockedResult(false, steps, counters, "dense");
    }

    const nextTravel = Math.min(maxDistanceM, traveled + stepDistance);
    const segmentDistance = nextTravel - traveled;
    const nextProbe = samplePrimaryProbe(
      state,
      counters,
      probe.x + sunDirX * segmentDistance,
      probe.y + sunDirY * segmentDistance,
      probe.z + sunDirZ * segmentDistance,
      "shadow",
      queryHeight,
    );

    if (nextProbe.terrain.unknown && state.config.query.unknownCountsAsBlockedForSun) {
      state.metrics.unknownSunSamples++;
      state.metrics.sunSteps.add(steps);
      return sunBlockedResult(true, steps, counters, "dense");
    }
    if (nextProbe.y <= nextProbe.terrain.height) {
      refinePrimaryCrossing(state, counters, probe, nextProbe, "shadow", queryHeight);
      state.metrics.sunSteps.add(steps);
      return sunBlockedResult(false, steps, counters, "dense");
    }

    traveled = nextTravel;
    probe = nextProbe;
  }

  state.metrics.sunSteps.add(steps);
  return { visible: true, unknown: counters.missingSamples > 0, blocked: false, steps, aadfSkips: 0, nearTableHits: counters.nearTableHits, hashFallbackHits: counters.hashFallbackHits, farClipmapHits: counters.farClipmapHits, missingSamples: counters.missingSamples, traversalMode: "dense" };
}

function samplePrimaryProbe(
  state: NaadfWorldState,
  counters: LocalCounters,
  x: number,
  y: number,
  z: number,
  purpose: QueryPurpose,
  queryHeight: QueryHeightFn,
): PrimaryProbe {
  const terrain = queryHeight({ state, worldX: x, worldZ: z, purpose });
  recordLocalCounters(counters, terrain);
  return { x, y, z, terrain };
}

function refinePrimaryCrossing(
  state: NaadfWorldState,
  counters: LocalCounters,
  start: PrimaryProbe,
  end: PrimaryProbe,
  purpose: QueryPurpose,
  queryHeight: QueryHeightFn,
): PrimaryProbe {
  let low = start;
  let high = end;
  for (let i = 0; i < ORACLE_REFINE_STEPS; i++) {
    const mid = samplePrimaryProbe(
      state,
      counters,
      (low.x + high.x) * 0.5,
      (low.y + high.y) * 0.5,
      (low.z + high.z) * 0.5,
      purpose,
      queryHeight,
    );
    if (mid.y <= mid.terrain.height) high = mid;
    else low = mid;
  }
  return high;
}

function primaryHitResult(
  probe: PrimaryProbe,
  steps: number,
  counters: LocalCounters,
  traversalMode: "dense",
): RayTraceResult {
  return {
    hit: true,
    unknown: probe.terrain.unknown,
    hitX: probe.x,
    hitY: probe.terrain.height,
    hitZ: probe.z,
    material: probe.terrain.material,
    steps,
    aadfSkips: 0,
    nearTableHits: counters.nearTableHits,
    hashFallbackHits: counters.hashFallbackHits,
    farClipmapHits: counters.farClipmapHits,
    missingSamples: counters.missingSamples,
    traversalMode,
  };
}

function sunBlockedResult(
  unknown: boolean,
  steps: number,
  counters: LocalCounters,
  traversalMode: "dense",
): SunVisibilityResult {
  return { visible: false, unknown, blocked: true, steps, aadfSkips: 0, nearTableHits: counters.nearTableHits, hashFallbackHits: counters.hashFallbackHits, farClipmapHits: counters.farClipmapHits, missingSamples: counters.missingSamples, traversalMode };
}

export function withIsolatedMetrics<T>(state: { metrics: unknown }, run: () => T): T {
  const originalMetrics = state.metrics;
  state.metrics = new NaadfMetricsCollector();
  try {
    return run();
  } finally {
    state.metrics = originalMetrics;
  }
}

function createLocalCounters(): LocalCounters {
  return { nearTableHits: 0, hashFallbackHits: 0, farClipmapHits: 0, missingSamples: 0 };
}

export function emptyRayResult(traversalMode: "dense"): RayTraceResult {
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
  };
}
