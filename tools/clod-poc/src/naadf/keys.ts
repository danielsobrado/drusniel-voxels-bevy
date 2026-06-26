import type { ChunkKey, SummaryTileKey } from "./types.js";

export function floorDiv(value: number, divisor: number): number {
  if (divisor === 0) return 0;
  return Math.floor(value / divisor);
}

export function floorMod(value: number, divisor: number): number {
  if (divisor === 0) return 0;
  return value - floorDiv(value, divisor) * divisor;
}

export function chunkKeyToString(key: ChunkKey): string {
  return `c:${key.x},${key.z}`;
}

export function summaryTileKeyToString(key: SummaryTileKey): string {
  return `t:${key.ring}:${key.x},${key.z}`;
}

export function chunkKeyEquals(a: ChunkKey, b: ChunkKey): boolean {
  return a.x === b.x && a.z === b.z;
}

export function worldToChunkKey(worldX: number, worldZ: number, chunkSizeCells: number): ChunkKey {
  return {
    x: floorDiv(worldX, chunkSizeCells),
    z: floorDiv(worldZ, chunkSizeCells),
  };
}

export function worldToLocalCell(
  worldX: number,
  worldZ: number,
  chunkKey: ChunkKey,
  chunkSizeCells: number,
): { localX: number; localZ: number } {
  const origin = chunkKeyToWorldOrigin(chunkKey, chunkSizeCells);
  return {
    localX: Math.floor(worldX - origin.x),
    localZ: Math.floor(worldZ - origin.z),
  };
}

export function chunkKeyToWorldOrigin(chunkKey: ChunkKey, chunkSizeCells: number): { x: number; z: number } {
  return {
    x: chunkKey.x * chunkSizeCells,
    z: chunkKey.z * chunkSizeCells,
  };
}

export function worldToSummaryTileKey(
  worldX: number,
  worldZ: number,
  ring: number,
  cellM: number,
  tileCells: number,
): SummaryTileKey {
  const tileSizeM = cellM * tileCells;
  return {
    ring,
    x: floorDiv(worldX, tileSizeM),
    z: floorDiv(worldZ, tileSizeM),
  };
}

export function summaryTileOrigin(
  key: SummaryTileKey,
  cellM: number,
  tileCells: number,
): { x: number; z: number } {
  const tileSizeM = cellM * tileCells;
  return {
    x: key.x * tileSizeM,
    z: key.z * tileSizeM,
  };
}
