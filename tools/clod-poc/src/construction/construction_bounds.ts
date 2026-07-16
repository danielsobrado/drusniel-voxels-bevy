import type { ConstructionPieceDef } from "./types.js";

export interface ConstructionBounds3d {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export function isFiniteConstructionPosition(value: readonly [number, number, number]): boolean {
  return Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);
}

export function rotatedConstructionDimensions(
  piece: ConstructionPieceDef,
  rotationQuarterTurns: number,
): readonly [number, number, number] {
  const turns = ((rotationQuarterTurns % 4) + 4) % 4;
  const [x, y, z] = piece.dimensionsM;
  return turns % 2 === 0 ? [x, y, z] : [z, y, x];
}

export function constructionBoundsFor(
  piece: ConstructionPieceDef,
  position: readonly [number, number, number],
  rotationQuarterTurns: number,
  insetM = 0,
): ConstructionBounds3d {
  const [sx, sy, sz] = rotatedConstructionDimensions(piece, rotationQuarterTurns);
  const hx = Math.max(0, sx * 0.5 - insetM);
  const hy = Math.max(0, sy * 0.5 - insetM);
  const hz = Math.max(0, sz * 0.5 - insetM);
  return {
    minX: position[0] - hx,
    maxX: position[0] + hx,
    minY: position[1] - hy,
    maxY: position[1] + hy,
    minZ: position[2] - hz,
    maxZ: position[2] + hz,
  };
}

export function constructionBoundsOverlap(a: ConstructionBounds3d, b: ConstructionBounds3d): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX
    && a.minY <= b.maxY && a.maxY >= b.minY
    && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}
