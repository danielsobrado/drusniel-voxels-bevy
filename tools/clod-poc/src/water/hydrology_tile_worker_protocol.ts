// Message protocol for the hydrology tile build worker.
//
// A hydrology tile is a pure function of (tileX, tileZ, terrain sampler, options) —
// see hydrologyTileSource.ts. The worker reconstructs the exact main-thread sampler
// chain: makeFakeBodyCarvedSampler(waterFakeBodies, { surfaceHeight: baseSurfaceHeight })
// with the same terrain field config installed, so worker-built tiles are bit-identical
// to the synchronous fallback path.

import type { TerrainFieldConfigInput } from "../terrain/terrain_surface.js";
import type { WaterConfig } from "./waterConfig.js";

export interface HydrologyTileWorkerConfigureRequest {
  type: "configure";
  configId: number;
  terrainFieldConfig: TerrainFieldConfigInput | null;
  fakeBodies: WaterConfig["fakeBodies"];
  tileSizeM: number;
  tileRes: number;
  drySentinelDepthM: number;
}

export interface HydrologyTileWorkerBuildRequest {
  type: "build";
  requestId: number;
  configId: number;
  tiles: { tileX: number; tileZ: number }[];
}

export type HydrologyTileWorkerRequest = HydrologyTileWorkerConfigureRequest | HydrologyTileWorkerBuildRequest;

export interface HydrologyTileWorkerBuiltTile {
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  cellSize: number;
  res: number;
  terrainY: Float32Array;
  waterY: Float32Array;
  bodyMask: Float32Array;
  lakeMask: Float32Array;
  riverMask: Float32Array;
  flowX: Float32Array;
  flowZ: Float32Array;
  flowStrength: Float32Array;
  riverDepth: Float32Array;
  moisture: Float32Array;
  shoreDistance: Float32Array;
  bodyKind: Uint8Array;
  bodyId: Uint32Array;
}

export type HydrologyTileWorkerResponse =
  | { type: "built"; requestId: number; configId: number; tiles: HydrologyTileWorkerBuiltTile[]; buildMs: number }
  | { type: "error"; requestId: number | null; message: string };

export function hydrologyTileTransferables(tiles: readonly HydrologyTileWorkerBuiltTile[]): Transferable[] {
  const buffers: Transferable[] = [];
  for (const tile of tiles) {
    buffers.push(
      tile.terrainY.buffer,
      tile.waterY.buffer,
      tile.bodyMask.buffer,
      tile.lakeMask.buffer,
      tile.riverMask.buffer,
      tile.flowX.buffer,
      tile.flowZ.buffer,
      tile.flowStrength.buffer,
      tile.riverDepth.buffer,
      tile.moisture.buffer,
      tile.shoreDistance.buffer,
      tile.bodyKind.buffer,
      tile.bodyId.buffer,
    );
  }
  return buffers;
}
