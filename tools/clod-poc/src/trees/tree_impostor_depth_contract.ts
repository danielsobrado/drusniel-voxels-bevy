export const TREE_IMPOSTOR_DEPTH_NEAR_M = 0.01;
export const TREE_IMPOSTOR_DEPTH_FAR_RADIUS_MULTIPLIER = 6;
export const TREE_IMPOSTOR_CAPTURE_DISTANCE_RADIUS_MULTIPLIER = 3;
export const TREE_IMPOSTOR_DEPTH_MAX_OFFSET_RADIUS = 0.95;
export const TREE_IMPOSTOR_DEPTH_GRID_SEGMENTS = 3;

export interface TreeImpostorDepthRange {
  readonly nearM: number;
  readonly farM: number;
  readonly captureDistanceM: number;
  readonly maxOffsetM: number;
}

export function treeImpostorDepthRange(radiusM: number): TreeImpostorDepthRange {
  const radius = Math.max(0.25, finiteOr(radiusM, 1));
  return {
    nearM: TREE_IMPOSTOR_DEPTH_NEAR_M,
    farM: radius * TREE_IMPOSTOR_DEPTH_FAR_RADIUS_MULTIPLIER,
    captureDistanceM: radius * TREE_IMPOSTOR_CAPTURE_DISTANCE_RADIUS_MULTIPLIER,
    maxOffsetM: radius * TREE_IMPOSTOR_DEPTH_MAX_OFFSET_RADIUS,
  };
}

export function decodeTreeImpostorDepthOffset(
  normalizedDepth: number,
  coverage: number,
  radiusM: number,
): number {
  if (!Number.isFinite(normalizedDepth) || !Number.isFinite(coverage) || coverage <= 0) return 0;
  const range = treeImpostorDepthRange(radiusM);
  const depth01 = clamp01(normalizedDepth);
  const distanceM = range.nearM + depth01 * (range.farM - range.nearM);
  const offsetM = range.captureDistanceM - distanceM;
  const coverageWeight = smoothstep(0.01, 0.15, clamp01(coverage));
  return clamp(offsetM, -range.maxOffsetM, range.maxOffsetM) * coverageWeight;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
