import type { RayTraceResult } from "./types.js";
import type { NaadfWorldState } from "./summaryStreamer.js";
import { tracePrimaryDebugRay } from "./query.js";

export type DebugRaySegment = Readonly<{
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
}>;

export type PrimaryRayDebugCapture = Readonly<{
  result: RayTraceResult;
  segments: ReadonlyArray<DebugRaySegment>;
}>;

export function capturePrimaryDebugRay(
  state: NaadfWorldState,
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistanceM: number,
): PrimaryRayDebugCapture {
  const result = tracePrimaryDebugRay({
    state,
    originX,
    originY,
    originZ,
    dirX,
    dirY,
    dirZ,
    maxDistanceM,
  });
  const segments: DebugRaySegment[] = [{
    fromX: originX,
    fromY: originY,
    fromZ: originZ,
    toX: result.hitX,
    toY: result.hitY,
    toZ: result.hitZ,
  }];
  return { result, segments };
}
