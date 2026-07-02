import type { RayTraceResult, SunVisibilityResult, TerrainQueryResult } from "./types.js";
import type { ResidentChunkEntry } from "./types.js";
import type { NaadfWorldState } from "./summaryStreamer.js";
import { worldToChunkKey, worldToLocalCell } from "./keys.js";
import { lookupValidatedChunkIndex } from "./residentLookup.js";
import { sampleFarSummary } from "./farClipmap.js";
import { ringForDistance } from "./config.js";
import { recordMissingSample } from "./queryHelpers.js";
import { compareRayResults, compareSunResults, tracePrimaryDebugRayHdda, traceSunVisibilityHdda } from "./hdda.js";
import { QUERYABLE_STATES } from "./query_constants.js";
export type { QueryPurpose, PrimaryDenseParams, SunDenseParams, LocalCounters, PrimaryProbe } from "./query_types.js";
import type { QueryPurpose, PrimaryDenseParams, SunDenseParams } from "./query_types.js";
import { tracePrimaryDebugRayDense, traceSunVisibilityDense, withIsolatedMetrics } from "./query_dense.js";

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

function finiteResult(h: number, mat: number, canopy: number, water: number, source: "near_table" | "hash_fallback"): TerrainQueryResult {
  return {
    height: h, material: mat, canopyCoverage: canopy, waterCoverage: water,
    normalX: 0, normalY: 1, normalZ: 0, unknown: false, source,
    nearTableHit: source === "near_table", hashFallbackHit: source === "hash_fallback",
    farClipmapHit: false, missingSample: false,
  };
}

function unknownResult(): TerrainQueryResult {
  return {
    height: 0, material: 0, canopyCoverage: 0, waterCoverage: 0,
    normalX: 0, normalY: 1, normalZ: 0, unknown: true, source: "unknown",
    nearTableHit: false, hashFallbackHit: false, farClipmapHit: false, missingSample: true,
  };
}

export function tracePrimaryDebugRay(params: PrimaryDenseParams): RayTraceResult {
  if (params.state.config.traversal.mode === "hdda") {
    return tracePrimaryDebugRayHdda({ ...params, queryHeight: queryTerrainHeight });
  }
  if (params.state.config.traversal.mode === "compare") {
    const dense = withIsolatedMetrics(params.state, () => tracePrimaryDebugRayDense(params, queryTerrainHeight));
    const hdda = tracePrimaryDebugRayHdda({ ...params, queryHeight: queryTerrainHeight });
    const compare = compareRayResults(dense, hdda, { x: params.originX, y: params.originY, z: params.originZ }, params.state.config);
    if (compare.mismatchReason !== "none") {
      params.state.metrics.hddaDenseMismatches++;
      params.state.metrics.hddaFallbackToDense++;
      return { ...dense, traversalMode: "compare", hdda: hdda.hdda, compare };
    }
    return { ...hdda, traversalMode: "compare", compare };
  }
  return tracePrimaryDebugRayDense(params, queryTerrainHeight);
}

export function traceSunVisibility(params: SunDenseParams): SunVisibilityResult {
  if (params.state.config.traversal.mode === "hdda") {
    return traceSunVisibilityHdda({ ...params, queryHeight: queryTerrainHeight });
  }
  if (params.state.config.traversal.mode === "compare") {
    const dense = withIsolatedMetrics(params.state, () => traceSunVisibilityDense(params, queryTerrainHeight));
    const hdda = traceSunVisibilityHdda({ ...params, queryHeight: queryTerrainHeight });
    const compare = compareSunResults(dense, hdda);
    if (compare.mismatchReason !== "none") {
      params.state.metrics.hddaDenseMismatches++;
      params.state.metrics.hddaFallbackToDense++;
      return { ...dense, traversalMode: "compare", hdda: hdda.hdda, compare };
    }
    return { ...hdda, traversalMode: "compare", compare };
  }
  return traceSunVisibilityDense(params, queryTerrainHeight);
}
