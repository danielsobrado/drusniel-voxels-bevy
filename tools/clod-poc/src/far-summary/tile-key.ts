import type { FarSummaryTileKey } from "./types.js";

export function makeTileKey(
  ring: number,
  tileX: number,
  tileZ: number,
  cellSizeM: number,
): FarSummaryTileKey {
  return { ring, x: tileX, z: tileZ, cellSizeM };
}

export function tileKeyToString(key: FarSummaryTileKey): string {
  return `r${key.ring}_x${key.x}_z${key.z}_cs${key.cellSizeM}`;
}

export function tileKeyEquals(a: FarSummaryTileKey, b: FarSummaryTileKey): boolean {
  return a.ring === b.ring && a.x === b.x && a.z === b.z && a.cellSizeM === b.cellSizeM;
}

export function worldToTileCoord(
  worldCoord: number,
  cellSizeM: number,
  tileCells: number,
): number {
  const tileSizeM = cellSizeM * tileCells;
  return Math.floor(worldCoord / tileSizeM);
}

export function tileOrigin(
  tileCoord: number,
  cellSizeM: number,
  tileCells: number,
): number {
  return tileCoord * cellSizeM * tileCells;
}

export function tileCenter(
  tileCoord: number,
  cellSizeM: number,
  tileCells: number,
): number {
  return (tileCoord + 0.5) * cellSizeM * tileCells;
}
