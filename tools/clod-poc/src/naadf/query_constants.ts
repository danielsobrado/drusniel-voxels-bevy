import type { ResidentChunkEntry } from "./types.js";

export const QUERYABLE_STATES: ReadonlySet<ResidentChunkEntry["state"]> = new Set([
  "ready",
  "stale",
  "building",
]);

export const ORACLE_REFINE_STEPS = 8;
