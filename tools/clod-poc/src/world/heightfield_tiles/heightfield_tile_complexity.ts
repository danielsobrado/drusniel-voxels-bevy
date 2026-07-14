import type { VoxelOverlaySource } from "../../terrain/voxel_overlay/voxel_overlay.js";
import { tileOriginM, WORLD_TILE_SIZE_M, type WorldTileKey } from "../tile_key.js";

export const HEIGHTFIELD_COMPLEXITY_CELL_SIZE_M = 4;
export const HEIGHTFIELD_COMPLEXITY_RES = WORLD_TILE_SIZE_M / HEIGHTFIELD_COMPLEXITY_CELL_SIZE_M;
export const HEIGHTFIELD_COMPLEXITY_CELL_COUNT = HEIGHTFIELD_COMPLEXITY_RES * HEIGHTFIELD_COMPLEXITY_RES;

export interface HeightfieldTileComplexity {
  readonly complexVolumeMask: Uint8Array | null;
  readonly entranceMask: Uint8Array | null;
  readonly voxelRegionRefs: readonly string[];
}

export const EMPTY_HEIGHTFIELD_TILE_COMPLEXITY: HeightfieldTileComplexity = Object.freeze({
  complexVolumeMask: null,
  entranceMask: null,
  voxelRegionRefs: Object.freeze([]),
});

function setCoveredCells(mask: Uint8Array, origin: { x: number; z: number }, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
  const minX = Math.max(0, Math.floor((bounds.minX - origin.x) / HEIGHTFIELD_COMPLEXITY_CELL_SIZE_M));
  const minZ = Math.max(0, Math.floor((bounds.minZ - origin.z) / HEIGHTFIELD_COMPLEXITY_CELL_SIZE_M));
  const maxX = Math.min(HEIGHTFIELD_COMPLEXITY_RES - 1, Math.floor((bounds.maxX - origin.x) / HEIGHTFIELD_COMPLEXITY_CELL_SIZE_M));
  const maxZ = Math.min(HEIGHTFIELD_COMPLEXITY_RES - 1, Math.floor((bounds.maxZ - origin.z) / HEIGHTFIELD_COMPLEXITY_CELL_SIZE_M));
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) mask[z * HEIGHTFIELD_COMPLEXITY_RES + x] = 1;
  }
}

export function buildHeightfieldTileComplexity(
  key: WorldTileKey,
  source: VoxelOverlaySource | null | undefined,
): HeightfieldTileComplexity {
  if (!source || source.regions.length === 0) return EMPTY_HEIGHTFIELD_TILE_COMPLEXITY;
  const origin = tileOriginM(key);
  const tileBounds = { minX: origin.x, minZ: origin.z, maxX: origin.x + WORLD_TILE_SIZE_M, maxZ: origin.z + WORLD_TILE_SIZE_M };
  const regions = source.regions.filter((region) =>
    region.bounds.maxX >= tileBounds.minX && region.bounds.minX <= tileBounds.maxX
    && region.bounds.maxZ >= tileBounds.minZ && region.bounds.minZ <= tileBounds.maxZ);
  if (regions.length === 0) return EMPTY_HEIGHTFIELD_TILE_COMPLEXITY;

  const complexVolumeMask = new Uint8Array(HEIGHTFIELD_COMPLEXITY_CELL_COUNT);
  let entranceMask: Uint8Array | null = null;
  for (const region of regions) {
    setCoveredCells(complexVolumeMask, origin, region.bounds);
    for (const entrance of region.caveEntrances) {
      entranceMask ??= new Uint8Array(HEIGHTFIELD_COMPLEXITY_CELL_COUNT);
      const radius = entrance.farMaskRadiusM;
      setCoveredCells(entranceMask, origin, {
        minX: entrance.position[0] - radius,
        minZ: entrance.position[2] - radius,
        maxX: entrance.position[0] + radius,
        maxZ: entrance.position[2] + radius,
      });
    }
  }
  return { complexVolumeMask, entranceMask, voxelRegionRefs: regions.map((region) => region.id) };
}
