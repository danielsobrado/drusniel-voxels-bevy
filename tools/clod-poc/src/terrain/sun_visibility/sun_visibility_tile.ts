export function sunVisibilityTileKeyToString(tile: any): string {
  return `${tile.lod}:${tile.tileX},${tile.tileZ}`;
}

export function worldToSunVisibilityTile(x: number, z: number, config: any) {
  return {
    tileX: Math.floor(x / config.sizeWorld),
    tileZ: Math.floor(z / config.sizeWorld),
    lod: 0,
  };
}

export function sunVisibilityTileBounds(tile: any, config: any) {
  const minX = tile.tileX * config.sizeWorld;
  const minZ = tile.tileZ * config.sizeWorld;
  return {
    minX,
    minZ,
    maxX: minX + config.sizeWorld,
    maxZ: minZ + config.sizeWorld,
  };
}

export function sunVisibilityTileCellCenter(tile: any, cellX: number, cellZ: number, config: any) {
  const bounds = sunVisibilityTileBounds(tile, config);
  const cellSize = config.sizeWorld / config.resolution;
  return {
    x: bounds.minX + (cellX + 0.5) * cellSize,
    z: bounds.minZ + (cellZ + 0.5) * cellSize,
  };
}
