import type { NaadfPocConfig } from "./config.js";
import type {
  HddaCompareResult,
  HddaMismatchReason,
  HddaTraversalStats,
  RayTraceResult,
  SunVisibilityResult,
} from "./types.js";
import { INF } from "./hddaConstants.js";

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

export function createTraversalStats(): HddaTraversalStats {
  return { spanSteps: 0, chunkSkips: 0, blockSkips: 0, voxelSteps: 0 };
}

export function normalizeRay(dirX: number, dirY: number, dirZ: number): { dirX: number; dirY: number; dirZ: number } | null {
  const len = Math.hypot(dirX, dirY, dirZ);
  if (len < 1e-10) return null;
  return { dirX: dirX / len, dirY: dirY / len, dirZ: dirZ / len };
}

export function emptyRayResult(traversalMode: "hdda"): RayTraceResult {
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

export function emptySunResult(traversalMode: "hdda"): SunVisibilityResult {
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
