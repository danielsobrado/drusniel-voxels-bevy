export const WORLD_TILE_SIZE_M = 256;
export const SAVE_REGION_TILES_PER_AXIS = 2;
export const CLOD_PAGES_PER_WORLD_TILE_AXIS = 4;

export interface WorldTileKey {
  readonly x: number;
  readonly z: number;
}

export interface WorldTileOrigin {
  readonly x: number;
  readonly z: number;
}

function assertFiniteCoordinate(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite: ${value}`);
}

function assertTileKey(key: WorldTileKey): void {
  if (!Number.isSafeInteger(key.x) || !Number.isSafeInteger(key.z)) {
    throw new Error(`world tile coordinates must be safe integers: ${key.x}, ${key.z}`);
  }
}

export function worldToTile(x: number, z: number): WorldTileKey {
  assertFiniteCoordinate(x, "world x");
  assertFiniteCoordinate(z, "world z");
  return Object.freeze({
    x: Math.floor(x / WORLD_TILE_SIZE_M),
    z: Math.floor(z / WORLD_TILE_SIZE_M),
  });
}

export function tileOriginM(key: WorldTileKey): WorldTileOrigin {
  assertTileKey(key);
  return Object.freeze({
    x: key.x * WORLD_TILE_SIZE_M,
    z: key.z * WORLD_TILE_SIZE_M,
  });
}

export function tileKeyString(key: WorldTileKey): string {
  assertTileKey(key);
  return `T:${key.x},${key.z}`;
}

export function toHydrologyTileCoord(key: WorldTileKey): { tileX: number; tileZ: number } {
  assertTileKey(key);
  return { tileX: key.x, tileZ: key.z };
}

export function toSaveRegionKey(key: WorldTileKey): string {
  assertTileKey(key);
  const rx = Math.floor(key.x / SAVE_REGION_TILES_PER_AXIS);
  const rz = Math.floor(key.z / SAVE_REGION_TILES_PER_AXIS);
  return `r_${rx}_${rz}`;
}

export function clodPagesForTile(key: WorldTileKey): Array<{ px: number; pz: number; level: 0 }> {
  assertTileKey(key);
  const minPx = key.x * CLOD_PAGES_PER_WORLD_TILE_AXIS;
  const minPz = key.z * CLOD_PAGES_PER_WORLD_TILE_AXIS;
  const pages: Array<{ px: number; pz: number; level: 0 }> = [];
  for (let pz = minPz; pz < minPz + CLOD_PAGES_PER_WORLD_TILE_AXIS; pz++) {
    for (let px = minPx; px < minPx + CLOD_PAGES_PER_WORLD_TILE_AXIS; px++) {
      pages.push({ px, pz, level: 0 });
    }
  }
  return pages;
}
