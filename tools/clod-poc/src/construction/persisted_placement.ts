import { isPlacedPieceSupported } from "./support_state.js";
import type { ConstructionPieceDef, ConstructionPlacementConfig, PlacedConstructionPiece } from "./types.js";

export interface PersistedConstructionPlacementValidationInput {
  piece: ConstructionPieceDef;
  placed: PlacedConstructionPiece;
  placedPieces: readonly PlacedConstructionPiece[];
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  worldCells: number;
  config: ConstructionPlacementConfig;
  allowLegacySupportMetadata?: boolean;
}

interface Bounds3d {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function isFiniteVec3(value: readonly [number, number, number]): boolean {
  return Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);
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

function validateBoundsAndOverlap(
  piece: ConstructionPieceDef,
  position: readonly [number, number, number],
  rotationQuarterTurns: number,
  placedPieces: readonly PlacedConstructionPiece[],
  piecesById: ReadonlyMap<string, ConstructionPieceDef>,
  worldCells: number,
  config: ConstructionPlacementConfig,
): { valid: boolean; reason: string | null } {
  if (!isFiniteVec3(position) || !Number.isFinite(worldCells) || worldCells <= 0) {
    return { valid: false, reason: "invalid position" };
  }

  const worldBounds = boundsFor(piece, position, rotationQuarterTurns, 0);
  if (worldBounds.minX < 0 || worldBounds.maxX > worldCells || worldBounds.minZ < 0 || worldBounds.maxZ > worldCells) {
    return { valid: false, reason: "outside world" };
  }

  const bounds = boundsFor(piece, position, rotationQuarterTurns, config.overlapPaddingM);
  for (const placed of placedPieces) {
    const otherPiece = piecesById.get(placed.typeId);
    if (!otherPiece) continue;
    const otherBounds = boundsFor(otherPiece, placed.position, placed.rotationQuarterTurns, config.overlapPaddingM);
    if (overlaps(bounds, otherBounds)) return { valid: false, reason: "overlap" };
  }
  return { valid: true, reason: null };
}

function hasLegacySupportMetadata(placed: PlacedConstructionPiece): boolean {
  return placed.grounded === undefined && placed.parentIds === undefined;
}

function validatePersistedSupport(
  piece: ConstructionPieceDef,
  placed: PlacedConstructionPiece,
  placedPieces: readonly PlacedConstructionPiece[],
  allowLegacySupportMetadata: boolean,
): { valid: boolean; reason: string | null } {
  if (hasLegacySupportMetadata(placed)) {
    if (!allowLegacySupportMetadata) return { valid: false, reason: "missing support" };
    return piece.canGround ? { valid: true, reason: null } : { valid: false, reason: "invalid support" };
  }
  if (placed.grounded === true) {
    return piece.canGround ? { valid: true, reason: null } : { valid: false, reason: "invalid support" };
  }
  const parentIds = placed.parentIds ?? [];
  if (parentIds.some((parentId) => isPlacedPieceSupported(placedPieces, parentId))) {
    return { valid: true, reason: null };
  }
  return { valid: false, reason: "unsupported" };
}

export function validateStrictPersistedConstructionPlacement(
  input: PersistedConstructionPlacementValidationInput,
): { valid: boolean; reason: string | null } {
  const { piece, placed, placedPieces, piecesById, worldCells, config, allowLegacySupportMetadata = false } = input;
  const support = validatePersistedSupport(piece, placed, placedPieces, allowLegacySupportMetadata);
  if (!support.valid) return support;
  return validateBoundsAndOverlap(piece, placed.position, placed.rotationQuarterTurns, placedPieces, piecesById, worldCells, config);
}
