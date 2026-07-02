import type { TerrainQueryResult } from "./types.js";
import type { NaadfWorldState } from "./summaryStreamer.js";

export type QueryPurpose = "render" | "shadow" | "canopy" | "material" | "debug";

export type PrimaryDenseParams = {
  state: NaadfWorldState;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  maxDistanceM: number;
};

export type SunDenseParams = {
  state: NaadfWorldState;
  worldX: number;
  worldY: number;
  worldZ: number;
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  maxDistanceM: number;
};

export type LocalCounters = {
  nearTableHits: number;
  hashFallbackHits: number;
  farClipmapHits: number;
  missingSamples: number;
};

export type PrimaryProbe = Readonly<{
  x: number;
  y: number;
  z: number;
  terrain: TerrainQueryResult;
}>;
