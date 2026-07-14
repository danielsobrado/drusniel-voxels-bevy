import type { HeightfieldTile } from "./heightfield_tile.js";
import type { WorldTileKey } from "../tile_key.js";

export interface HeightfieldTileWorkerBuildRequest {
  type: "buildHeightfieldTiles";
  requestId: number;
  keys: WorldTileKey[];
  sourceRevision: number;
}

export interface HeightfieldTileWorkerBuiltResponse {
  type: "heightfieldTilesBuilt";
  requestId: number;
  tiles: HeightfieldTile[];
  buildMs: number;
  transferBytes: number;
}

export type HeightfieldTileWorkerRequest = HeightfieldTileWorkerBuildRequest;
export type HeightfieldTileWorkerResponse = HeightfieldTileWorkerBuiltResponse;

export function collectHeightfieldTileTransferables(
  tiles: readonly HeightfieldTile[],
): Transferable[] {
  return tiles.flatMap((tile) => [
    tile.heights.buffer as ArrayBuffer,
    ...(tile.complexVolumeMask ? [tile.complexVolumeMask.buffer as ArrayBuffer] : []),
    ...(tile.entranceMask ? [tile.entranceMask.buffer as ArrayBuffer] : []),
  ]);
}
