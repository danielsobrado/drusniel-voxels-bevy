export interface SunVisibilityTileKey {
  tileX: number;
  tileZ: number;
  lod: number;
}

export interface SunVisibilityTileConfig {
  sizeWorld: number;
  resolution: number;
}

export interface SunVisibilityTileBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface SunVisibilityTileCellCenter {
  x: number;
  z: number;
}

export function sunVisibilityTileKeyToString(tile: SunVisibilityTileKey): string {
  return `${tile.lod}:${tile.tileX},${tile.tileZ}`;
}

export function worldToSunVisibilityTile(x: number, z: number, config: SunVisibilityTileConfig): SunVisibilityTileKey {
  return {
    tileX: Math.floor(x / config.sizeWorld),
    tileZ: Math.floor(z / config.sizeWorld),
    lod: 0,
  };
}

export function sunVisibilityTileBounds(tile: SunVisibilityTileKey, config: SunVisibilityTileConfig): SunVisibilityTileBounds {
  const minX = tile.tileX * config.sizeWorld;
  const minZ = tile.tileZ * config.sizeWorld;
  return {
    minX,
    minZ,
    maxX: minX + config.sizeWorld,
    maxZ: minZ + config.sizeWorld,
  };
}

export function sunVisibilityTileCellCenter(
  tile: SunVisibilityTileKey,
  cellX: number,
  cellZ: number,
  config: SunVisibilityTileConfig,
): SunVisibilityTileCellCenter {
  const bounds = sunVisibilityTileBounds(tile, config);
  const cellSize = config.sizeWorld / config.resolution;
  return {
    x: bounds.minX + (cellX + 0.5) * cellSize,
    z: bounds.minZ + (cellZ + 0.5) * cellSize,
  };
}
