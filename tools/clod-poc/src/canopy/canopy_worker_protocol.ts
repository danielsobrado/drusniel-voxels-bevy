// Message protocol for the canopy tile build worker.
//
// Canopy summary tiles are pure functions of (terrain field config, terrain summary heights,
// tree distribution config + seed, canopy shell config, tile coords), so they can build off the
// main thread with bit-identical results. The worker reconstructs the same samplers the main
// thread uses: `surfaceHeightCore(x, z, terrainFieldConfig)` matches `WorldSource.sampleHeight`
// and the summary height blend only reads res/worldSize/heightMin/heightMax.

import type { CanopySummaryCell, CanopySummaryTile, CanopyWorldKey } from "./canopy_types.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import type { TerrainFieldConfig } from "../terrain/terrain.js";

/** Subset of TerrainSummaryField the height-blend path reads; arrays are copies, not views. */
export interface CanopyWorkerSummaryPayload {
  res: number;
  worldSize: number;
  farReduceFactor: number;
  heightMin: Float32Array;
  heightMax: Float32Array;
}

export interface CanopyWorkerConfigureRequest {
  type: "configure";
  configId: number;
  terrainFieldConfig: TerrainFieldConfig | null;
  summary: CanopyWorkerSummaryPayload | null;
  farRadius: number;
  config: CanopyShellConfig;
}

export interface CanopyWorkerTileCoord {
  key: CanopyWorldKey;
  originX: number;
  originZ: number;
  cellSizeM: number;
  resolution: number;
  revision: number;
}

export interface CanopyWorkerBuildRequest {
  type: "build";
  requestId: number;
  configId: number;
  tiles: CanopyWorkerTileCoord[];
}

export type CanopyWorkerRequest = CanopyWorkerConfigureRequest | CanopyWorkerBuildRequest;

export interface CanopyWorkerBuiltTile {
  key: CanopyWorldKey;
  originX: number;
  originZ: number;
  cellSizeM: number;
  resolution: number;
  revision: number;
  /** CANOPY_CELL_FLOATS values per cell, row-major; f64 keeps worker tiles bit-identical. */
  cells: Float64Array;
}

export type CanopyWorkerResponse =
  | { type: "built"; requestId: number; configId: number; tiles: CanopyWorkerBuiltTile[]; buildMs: number }
  | { type: "error"; requestId: number | null; message: string };

export const CANOPY_CELL_FLOATS = 9;

export function packCanopyCells(cells: readonly CanopySummaryCell[]): Float64Array {
  const out = new Float64Array(cells.length * CANOPY_CELL_FLOATS);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const base = i * CANOPY_CELL_FLOATS;
    out[base] = cell.groundHeight;
    out[base + 1] = cell.canopyHeight;
    out[base + 2] = cell.coverage;
    out[base + 3] = cell.crownRoughness;
    out[base + 4] = cell.slope;
    out[base + 5] = cell.moisture;
    out[base + 6] = cell.speciesPine;
    out[base + 7] = cell.speciesBroadleaf;
    out[base + 8] = cell.speciesDeadwood;
  }
  return out;
}

export function unpackCanopyCells(packed: Float64Array, cellCount: number): CanopySummaryCell[] {
  const cells: CanopySummaryCell[] = new Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const base = i * CANOPY_CELL_FLOATS;
    cells[i] = {
      groundHeight: packed[base]!,
      canopyHeight: packed[base + 1]!,
      coverage: packed[base + 2]!,
      crownRoughness: packed[base + 3]!,
      slope: packed[base + 4]!,
      moisture: packed[base + 5]!,
      speciesPine: packed[base + 6]!,
      speciesBroadleaf: packed[base + 7]!,
      speciesDeadwood: packed[base + 8]!,
    };
  }
  return cells;
}

export function packCanopyTile(tile: CanopySummaryTile): CanopyWorkerBuiltTile {
  return {
    key: { ...tile.key },
    originX: tile.originX,
    originZ: tile.originZ,
    cellSizeM: tile.cellSizeM,
    resolution: tile.resolution,
    revision: tile.revision,
    cells: packCanopyCells(tile.cells),
  };
}

export function unpackCanopyTile(tile: CanopyWorkerBuiltTile): CanopySummaryTile {
  return {
    key: { ...tile.key },
    originX: tile.originX,
    originZ: tile.originZ,
    cellSizeM: tile.cellSizeM,
    resolution: tile.resolution,
    revision: tile.revision,
    cells: unpackCanopyCells(tile.cells, tile.resolution * tile.resolution),
  };
}
