import type { PropAssetDef } from "./prop_types.js";

export interface PropLodSelectionParams {
  camPos: [number, number, number];
  propPos: [number, number, number];
  viewportH: number;
  fovY: number;
  thresholdPx: number;
}

/** Screen-space error for a prop LOD band, matching CLOD terrain error_px. */
export function propLodErrorPx(errorWorld: number, distance: number, viewportH: number, fovY: number): number {
  const dist = Math.max(0.001, distance);
  return (errorWorld * viewportH) / (2 * dist * Math.tan(fovY / 2));
}

export function propDistanceToCamera(
  camPos: [number, number, number],
  propPos: [number, number, number],
  boundingRadius = 0,
): number {
  const d = Math.hypot(camPos[0] - propPos[0], camPos[1] - propPos[1], camPos[2] - propPos[2]);
  return Math.max(0.001, d - boundingRadius);
}

function lodIndexForDistance(distance: number, distances: number[]): number {
  let selected = 0;
  for (let i = 0; i < distances.length; i++) {
    if (distance >= distances[i]!) selected = i;
  }
  return selected;
}

function lodIndexForErrorPx(
  asset: PropAssetDef,
  params: PropLodSelectionParams,
  distance: number,
  lodErrorWorld: readonly number[],
): number {
  const lodCount = Math.min(asset.lod.distances.length, lodErrorWorld.length);
  let selected = 0;
  for (let i = lodCount - 1; i >= 0; i--) {
    const px = propLodErrorPx(lodErrorWorld[i] ?? 0, distance, params.viewportH, params.fovY);
    if (px <= params.thresholdPx) {
      selected = i;
      break;
    }
  }
  return selected;
}

/**
 * Select prop LOD using stored simplification error when available, otherwise distance bands.
 */
export function selectPropLodIndex(
  asset: PropAssetDef,
  params: PropLodSelectionParams,
  boundingRadius = 0,
  previousLod: number | null = null,
  lodErrorWorld?: readonly number[],
): number {
  const distance = propDistanceToCamera(params.camPos, params.propPos, boundingRadius);
  if (distance >= asset.culling.maxDistance) return -1;

  const billboardFrom = asset.lod.billboardFrom;
  if (billboardFrom !== undefined && distance >= billboardFrom) {
    return asset.lod.distances.length;
  }

  const selected =
    lodErrorWorld && lodErrorWorld.length > 0
      ? lodIndexForErrorPx(asset, params, distance, lodErrorWorld)
      : lodIndexForDistance(distance, asset.lod.distances);

  if (previousLod !== null && previousLod >= 0) {
    return applyPropLodHysteresis(selected, previousLod, distance, asset.lod.distances, asset.lod.hysteresis);
  }
  return selected;
}

function applyPropLodHysteresis(
  targetLod: number,
  previousLod: number,
  distance: number,
  distances: number[],
  hysteresisM: number,
): number {
  if (targetLod === previousLod) return previousLod;
  const boundary = distances[Math.max(targetLod, previousLod)] ?? 0;
  if (targetLod < previousLod) {
    return distance <= boundary + hysteresisM ? previousLod : targetLod;
  }
  return distance >= boundary - hysteresisM ? previousLod : targetLod;
}

export function propCastsShadow(asset: PropAssetDef, distance: number): boolean {
  return distance <= asset.culling.shadowDistance;
}

export function propInReflection(asset: PropAssetDef, distance: number): boolean {
  return distance <= asset.culling.reflectionDistance;
}

export function propNeedsCollider(asset: PropAssetDef, distance: number): boolean {
  if (asset.collision.mode === "none") return false;
  return distance <= asset.collision.distance;
}
