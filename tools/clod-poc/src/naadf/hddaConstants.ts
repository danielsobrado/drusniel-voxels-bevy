import type { ResidentChunkEntry } from "./types.js";

export const INF = Number.POSITIVE_INFINITY;
export const AXIS_X = 0;
export const AXIS_Y = 1;
export const AXIS_Z = 2;
export const HIERARCHY_CHUNK_SPAN = 16;
export const HIERARCHY_BLOCK_SPAN = 4;
export const HIERARCHY_VOXEL_SPAN = 1;
export const SUN_MIN_SUMMARY_LEVEL = 2;

export const QUERYABLE_STATES: ReadonlySet<ResidentChunkEntry["state"]> = new Set([
  "ready",
  "stale",
  "building",
]);
