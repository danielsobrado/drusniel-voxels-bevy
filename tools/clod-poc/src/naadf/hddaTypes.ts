import type { NaadfWorldState } from "./summaryStreamer.js";
import type { MipSummaryNode, TerrainQueryResult } from "./types.js";

export type QueryPurpose = "render" | "shadow" | "canopy" | "material" | "debug";

export interface QueryHeightParams {
  state: NaadfWorldState;
  worldX: number;
  worldZ: number;
  purpose: QueryPurpose;
}

export type QueryHeightFn = (params: QueryHeightParams) => TerrainQueryResult;

export interface TraceBaseParams {
  state: NaadfWorldState;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  maxDistanceM: number;
  queryHeight: QueryHeightFn;
}

export interface SunTraceBaseParams {
  state: NaadfWorldState;
  worldX: number;
  worldY: number;
  worldZ: number;
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  maxDistanceM: number;
  queryHeight: QueryHeightFn;
}

export interface SpanPlan {
  readonly spanDim: number;
  readonly node: MipSummaryNode | null;
  readonly source: "resident" | "far" | "fallback";
}
