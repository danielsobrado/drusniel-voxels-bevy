export const TREE_IMPOSTOR_DEPTH_ENCODING = "center-relative-v2" as const;
export type TreeImpostorDepthEncoding = typeof TREE_IMPOSTOR_DEPTH_ENCODING | "view-linear-v1";

declare module "./tree_impostor_baker.js" {
  interface TreeImpostorAtlas {
    depthEncoding?: TreeImpostorDepthEncoding;
  }
}

export const TREE_IMPOSTOR_DEPTH_NEAR_M = 0.01;
export const TREE_IMPOSTOR_DEPTH_FAR_RADIUS_MULTIPLIER = 6;
export const TREE_IMPOSTOR_DEPTH_EXTENT_DIVISOR = 4;
export const TREE_IMPOSTOR_DEPTH_GRID_SEGMENTS = 3;

export interface TreeImpostorDepthRange {
  readonly nearM: number;
  readonly farM: number;
  readonly extentM: number;
}

export function markTreeImpostorCenterRelativeDepth(
  atlas: { depthEncoding?: TreeImpostorDepthEncoding },
): void {
  atlas.depthEncoding = TREE_IMPOSTOR_DEPTH_ENCODING;
}

export function treeImpostorDepthRange(radiusM: number): TreeImpostorDepthRange {
  const radius = Math.max(0.25, finiteOr(radiusM, 1));
  const nearM = TREE_IMPOSTOR_DEPTH_NEAR_M;
  const farM = radius * TREE_IMPOSTOR_DEPTH_FAR_RADIUS_MULTIPLIER;
  return {
    nearM,
    farM,
    extentM: (farM - nearM) / TREE_IMPOSTOR_DEPTH_EXTENT_DIVISOR,
  };
}

export function encodeTreeImpostorRelativeDepth(relativeDepthM: number, radiusM: number): number {
  if (!Number.isFinite(relativeDepthM)) return 0.5;
  const { extentM } = treeImpostorDepthRange(radiusM);
  return clamp01(relativeDepthM / Math.max(extentM, 1e-6) * 0.5 + 0.5);
}

export function decodeTreeImpostorDepthOffset(
  normalizedDepth: number,
  coverage: number,
  radiusM: number,
): number {
  if (!Number.isFinite(normalizedDepth) || !Number.isFinite(coverage) || coverage <= 0) return 0;
  const { extentM } = treeImpostorDepthRange(radiusM);
  const offsetM = (clamp01(normalizedDepth) * 2 - 1) * extentM;
  const coverageWeight = smoothstep(0.01, 0.15, clamp01(coverage));
  return clamp(offsetM, -extentM, extentM) * coverageWeight;
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
