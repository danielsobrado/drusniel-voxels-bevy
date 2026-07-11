// Message protocol for the sun-light tile build worker.
//
// A sun-visibility tile is a pure function of (summary heightMax grid, analytic terrain
// config, sun-light options, tile coords, sun vector), so tiles can build off the main
// thread with bit-identical results. The worker samples heights through the same
// createSunLightHeightSampler used by the main-thread provider; its analytic fallback is
// surfaceHeightCore(x, z, terrainFieldConfig), which matches WorldSource.sampleHeight
// (the same exactness contract the canopy build worker relies on).

import type { SunDirectionBin } from "./sun_bins.js";
import type { SunLightOptions } from "./sun_light_options.js";
import type { TerrainFieldConfig } from "../terrain.js";

/** Subset of the terrain summary the height sampler reads; the array is a copy, not a view. */
export interface SunLightWorkerSummaryPayload {
  res: number;
  worldSize: number;
  heightMax: Float32Array;
}

export interface SunLightWorkerConfigureRequest {
  type: "configure";
  configId: number;
  terrainFieldConfig: TerrainFieldConfig | null;
  summary: SunLightWorkerSummaryPayload | null;
  options: SunLightOptions;
}

export interface SunLightWorkerTileRequest {
  /** Opaque cache key echoed back with the built tile. */
  key: string;
  tileX: number;
  tileZ: number;
  lod: number;
  sunVec: [number, number, number];
  sunBin: SunDirectionBin;
  terrainRevision: number;
  frameIndex: number;
}

export interface SunLightWorkerBuildRequest {
  type: "build";
  requestId: number;
  configId: number;
  tiles: SunLightWorkerTileRequest[];
}

export type SunLightWorkerRequest = SunLightWorkerConfigureRequest | SunLightWorkerBuildRequest;

export interface SunLightWorkerBuiltTile {
  key: string;
  resolution: number;
  values: Uint8Array;
}

export type SunLightWorkerResponse =
  | { type: "built"; requestId: number; configId: number; tiles: SunLightWorkerBuiltTile[]; buildMs: number }
  | { type: "error"; requestId: number | null; message: string };
