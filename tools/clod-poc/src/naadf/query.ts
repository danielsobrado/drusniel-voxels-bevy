import type {
  RayTraceResult,
  SunVisibilityResult,
  TerrainQueryResult,
} from "./types.js";
import type { NaadfWorldState } from "./summaryStreamer.js";
import { worldToChunkKey, worldToLocalCell } from "./keys.js";
import { lookupValidatedChunkIndex } from "./residentLookup.js";
import { sampleFarSummary } from "./farClipmap.js";
import { ringForDistance } from "./config.js";
import { recordMissingSample } from "./queryHelpers.js";
import type { ResidentChunkEntry } from "./types.js";
import { NaadfMetricsCollector } from "./metrics.js";
import {
  compareRayResults,
  compareSunResults,
  tracePrimaryDebugRayHdda,
  traceSunVisibilityHdda,
} from "./hdda.js";

const QUERYABLE_STATES: ReadonlySet<ResidentChunkEntry["state"]> = new Set([
  "ready",
  "stale",
  "building",
]);
const ORACLE_REFINE_STEPS = 8;

type QueryPurpose = "render" | "shadow" | "canopy" | "material" | "debug";

type PrimaryDenseParams = {
  state: NaadfWorldState;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  maxDistanceM: number;
};

type SunDenseParams = {
  state: NaadfWorldState;
  worldX: number;
  worldY: number;
  worldZ: number;
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  maxDistanceM: number;
};

type LocalCounters = {
  nearTableHits: number;
  hashFallbackHits: number;
  farClipmapHits: number;
  missingSamples: number;
};

type PrimaryProbe = Readonly<{
  x: number;
  y: number;
  z: number;
  terrain: TerrainQueryResult;
}>;

function activeBrick(entry: ResidentChunkEntry) {
  if (!QUERYABLE_STATES.has(entry.state)) return null;
  return entry.brick;
}

export function queryTerrainHeight(params: {
  state: NaadfWorldState;
  worldX: number;
  worldZ: number;
  purpose: QueryPurpose;
}): TerrainQueryResult {
  const { state, worldX, worldZ, purpose } = params;
  const chunkSize = state.config.world.chunkSizeCells;
  const key = worldToChunkKey(worldX, worldZ, chunkSize);
  const lookup = lookupValidatedChunkIndex(state.nearTable, state.hashFallback, state.residents, key);
  const dist = Math.hypot(worldX - state.cameraX, worldZ - state.cameraZ);

  if (lookup.source === "near_table") state.metrics.nearTableHits++;
  if (lookup.source === "hash_fallback") state.metrics.hashFallbackHits++;

  if (lookup.index >= 0) {
    const entry = state.residents[lookup.index];
    const brick = entry ? activeBrick(entry) : null;
    if (brick) {
      const local = worldToLocalCell(worldX, worldZ, key, chunkSize);
      const idx = local.localZ * chunkSize + local.localX;
      if (idx >= 0 && idx < brick.heights.length) {
        const h = brick.heights[idx]!;
        const mat = brick.materials[idx]!;
        const canopy = brick.canopyCoverage[idx]!;
        const water = brick.waterCoverage[idx]!;
        if (!Number.isFinite(h)) {
          recordMissingSample(state, purpose, true);
          return unknownResult();
        }
        if (purpose === "canopy") {
          state.metrics.canopySamples++;
          return finiteResult(h, mat, canopy, water, lookup.source === "near_table" ? "near_table" : "hash_fallback");
        }
        if (purpose === "render") state.metrics.farShellSamples++;
        return finiteResult(h, mat, canopy, water, lookup.source === "near_table" ? "near_table" : "hash_fallback");
      }
    }
  }

  if (state.forceMissingStress) {
    recordMissingSample(state, purpose, true);
    return unknownResult();
  }

  const ring = ringForDistance(dist, state.config);
  if (ring && dist >= ring.startM) {
    const far = sampleFarSummary({
      worldX,
      worldZ,
      purpose: purpose === "canopy" ? "canopy" : purpose === "material" ? "material" : "height",
      cameraX: state.cameraX,
      cameraZ: state.cameraZ,
      store: state.farTiles,
      config: state.config,
      source: state.source,
      forceMissingStress: state.forceMissingStress,
    });
    if (!far.unknown) {
      state.metrics.farClipmapHits++;
      if (purpose === "render") state.metrics.farShellSamples++;
      if (purpose === "canopy") state.metrics.canopySamples++;
      return {
        height: far.height,
        material: far.material,
        canopyCoverage: far.canopyCoverage,
        waterCoverage: far.waterCoverage,
        normalX: far.normalX,
        normalY: far.normalY,
        normalZ: far.normalZ,
        unknown: false,
        source: "far_clipmap",
        nearTableHit: false,
        hashFallbackHit: false,
        farClipmapHit: true,
        missingSample: false,
      };
    }
  }

  const macro = state.source.sample(worldX, worldZ);
  if (Number.isFinite(macro.height)) {
    if (purpose === "render") state.metrics.farShellSamples++;
    recordMissingSample(state, purpose, false);
    return {
      height: macro.height,
      material: macro.material,
      canopyCoverage: macro.canopyCoverage,
      waterCoverage: macro.waterCoverage,
      normalX: macro.normalX,
      normalY: macro.normalY,
      normalZ: macro.normalZ,
      unknown: false,
      source: "macro",
      nearTableHit: lookup.source === "near_table",
      hashFallbackHit: lookup.source === "hash_fallback",
      farClipmapHit: false,
      missingSample: true,
    };
  }

  recordMissingSample(state, purpose, true);
  return unknownResult();
}

function finiteResult(
  h: number,
  mat: number,
  canopy: number,
  water: number,
  source: "near_table" | "hash_fallback",
): TerrainQueryResult {
  return {
    height: h,
    material: mat,
    canopyCoverage: canopy,
    waterCoverage: water,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    unknown: false,
    source,
    nearTableHit: source === "near_table",
    hashFallbackHit: source === "hash_fallback",
    farClipmapHit: false,
    missingSample: false,
  };
}

function unknownResult(): TerrainQueryResult {
  return {
    height: 0,
    material: 0,
    canopyCoverage: 0,
    waterCoverage: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    unknown: true,
    source: "unknown",
    nearTableHit: false,
    hashFallbackHit: false,
    farClipmapHit: false,
    missingSample: true,
  };
}

export function tracePrimaryDebugRay(params: PrimaryDenseParams): RayTraceResult {
  if (params.state.config.traversal.mode === "hdda") {
    return tracePrimaryDebugRayHdda({ ...params, queryHeight: queryTerrainHeight });
  }
  if (params.state.config.traversal.mode === "compare") {
    const dense = withIsolatedMetrics(params.state, () => tracePrimaryDebugRayDense(params));
    const hdda = tracePrimaryDebugRayHdda({ ...params, queryHeight: queryTerrainHeight });
    const compare = compareRayResults(
      dense,
      hdda,
      { x: params.originX, y: params.originY, z: params.originZ },
      params.state.config,
    );
    if (compare.mismatchReason !== "none") {
      params.state.metrics.hddaDenseMismatches++;
      params.state.metrics.hddaFallbackToDense++;
      return { ...dense, traversalMode: "compare", hdda: hdda.hdda, compare };
    }
    return { ...hdda, traversalMode: "compare", compare };
  }
  return tracePrimaryDebugRayDense(params);
}

function tracePrimaryDebugRayDense(params: PrimaryDenseParams): RayTraceResult {
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
  let probe = samplePrimaryProbe(state, counters, originX, originY, originZ, "debug");

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
    );

    if (nextProbe.y <= nextProbe.terrain.height) {
      const hit = refinePrimaryCrossing(state, counters, probe, nextProbe, "debug");
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

export function traceSunVisibility(params: SunDenseParams): SunVisibilityResult {
  if (params.state.config.traversal.mode === "hdda") {
    return traceSunVisibilityHdda({ ...params, queryHeight: queryTerrainHeight });
  }
  if (params.state.config.traversal.mode === "compare") {
    const dense = withIsolatedMetrics(params.state, () => traceSunVisibilityDense(params));
    const hdda = traceSunVisibilityHdda({ ...params, queryHeight: queryTerrainHeight });
    const compare = compareSunResults(dense, hdda);
    if (compare.mismatchReason !== "none") {
      params.state.metrics.hddaDenseMismatches++;
      params.state.metrics.hddaFallbackToDense++;
      return { ...dense, traversalMode: "compare", hdda: hdda.hdda, compare };
    }
    return { ...hdda, traversalMode: "compare", compare };
  }
  return traceSunVisibilityDense(params);
}

function traceSunVisibilityDense(params: SunDenseParams): SunVisibilityResult {
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
  let probe = samplePrimaryProbe(state, counters, worldX, worldY, worldZ, "shadow");

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
    );

    if (nextProbe.terrain.unknown && state.config.query.unknownCountsAsBlockedForSun) {
      state.metrics.unknownSunSamples++;
      state.metrics.sunSteps.add(steps);
      return sunBlockedResult(true, steps, counters, "dense");
    }
    if (nextProbe.y <= nextProbe.terrain.height) {
      refinePrimaryCrossing(state, counters, probe, nextProbe, "shadow");
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
): PrimaryProbe {
  const terrain = queryTerrainHeight({ state, worldX: x, worldZ: z, purpose });
  recordLocalCounters(counters, terrain);
  return { x, y, z, terrain };
}

function refinePrimaryCrossing(
  state: NaadfWorldState,
  counters: LocalCounters,
  start: PrimaryProbe,
  end: PrimaryProbe,
  purpose: QueryPurpose,
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

function withIsolatedMetrics<T>(state: NaadfWorldState, run: () => T): T {
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

function recordLocalCounters(counters: LocalCounters, terrain: TerrainQueryResult): void {
  if (terrain.nearTableHit) counters.nearTableHits++;
  if (terrain.hashFallbackHit) counters.hashFallbackHits++;
  if (terrain.farClipmapHit) counters.farClipmapHits++;
  if (terrain.unknown || terrain.missingSample) counters.missingSamples++;
}

function emptyRayResult(traversalMode: "dense"): RayTraceResult {
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
