import type { ConstructionCandidate, ConstructionPieceDef, ConstructionPlacementConfig, ConstructionSnapResult, PlacedConstructionPiece } from "./types.js";

export interface TerrainHitPoint {
  point: readonly [number, number, number];
  distanceM: number;
}

export interface PlacementValidationInput {
  piece: ConstructionPieceDef;
  position: readonly [number, number, number];
  rotationQuarterTurns: number;
  snapped: boolean;
  snap: ConstructionSnapResult | null;
  terrainHit: TerrainHitPoint | null;
  placedPieces: readonly PlacedConstructionPiece[];
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  worldCells: number;
  config: ConstructionPlacementConfig;
}

interface Bounds3d {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function rotatedDimensions(piece: ConstructionPieceDef, rotationQuarterTurns: number): readonly [number, number, number] {
  const turns = ((rotationQuarterTurns % 4) + 4) % 4;
  const [x, y, z] = piece.dimensionsM;
  return turns % 2 === 0 ? [x, y, z] : [z, y, x];
}

function boundsFor(
  piece: ConstructionPieceDef,
  position: readonly [number, number, number],
  rotationQuarterTurns: number,
  paddingM: number,
): Bounds3d {
  const [sx, sy, sz] = rotatedDimensions(piece, rotationQuarterTurns);
  const hx = Math.max(0, sx * 0.5 - paddingM);
  const hy = Math.max(0, sy * 0.5 - paddingM);
  const hz = Math.max(0, sz * 0.5 - paddingM);
  return {
    minX: position[0] - hx,
    maxX: position[0] + hx,
    minY: position[1] - hy,
    maxY: position[1] + hy,
    minZ: position[2] - hz,
    maxZ: position[2] + hz,
  };
}

function overlaps(a: Bounds3d, b: Bounds3d): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX
    && a.minY <= b.maxY && a.maxY >= b.minY
    && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function isFinitePosition(position: readonly [number, number, number]): boolean {
  return position.every(Number.isFinite);
}

export function createFreePlacementPosition(
  piece: ConstructionPieceDef,
  terrainHit: TerrainHitPoint,
): readonly [number, number, number] {
  return [
    terrainHit.point[0],
    terrainHit.point[1] + piece.dimensionsM[1] * 0.5,
    terrainHit.point[2],
  ];
}

export function validateConstructionPlacement(input: PlacementValidationInput): { valid: boolean; reason: string | null } {
  const { piece, position, rotationQuarterTurns, snapped, terrainHit, placedPieces, piecesById, worldCells, config } = input;
  if (!isFinitePosition(position)) {
    return { valid: false, reason: "invalid position" };
  }
  if (!snapped && !piece.canGround) {
    return { valid: false, reason: "snap required" };
  }
  if (piece.canGround && !snapped && !terrainHit) {
    return { valid: false, reason: "no terrain" };
  }

  const bounds = boundsFor(piece, position, rotationQuarterTurns, config.overlapPaddingM);
  if (bounds.minX < 0 || bounds.maxX > worldCells || bounds.minZ < 0 || bounds.maxZ > worldCells) {
    return { valid: false, reason: "outside world" };
  }

  for (const placed of placedPieces) {
    const otherPiece = piecesById.get(placed.typeId);
    if (!otherPiece) continue;
    const otherBounds = boundsFor(otherPiece, placed.position, placed.rotationQuarterTurns, config.overlapPaddingM);
    if (overlaps(bounds, otherBounds)) {
      return { valid: false, reason: "overlap" };
    }
  }
  return { valid: true, reason: null };
}

export function createConstructionCandidate(input: PlacementValidationInput): ConstructionCandidate {
  const validation = validateConstructionPlacement(input);
  return {
    piece: input.piece,
    position: input.position,
    rotationQuarterTurns: input.rotationQuarterTurns,
    snapped: input.snapped,
    valid: validation.valid,
    reason: validation.reason,
    snap: input.snap,
  };
}

export const constructionPlacementMath = {
  rotatedDimensions,
  boundsFor,
};
