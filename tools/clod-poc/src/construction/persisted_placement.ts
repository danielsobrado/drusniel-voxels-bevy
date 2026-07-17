import { constructionBoundsFor, isFiniteConstructionPosition } from "./construction_bounds.js";
import { constructionPiecesOverlap } from "./construction_obb.js";
import { isPlacedPieceSupported } from "./support_state.js";
import type { ConstructionPieceDef, ConstructionPlacementConfig, PlacedConstructionPiece } from "./types.js";

export interface PersistedConstructionPlacementValidationInput {
  piece: ConstructionPieceDef;
  placed: PlacedConstructionPiece;
  placedPieces: readonly PlacedConstructionPiece[];
  overlapCandidates?: readonly PlacedConstructionPiece[];
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  worldCells: number;
  config: ConstructionPlacementConfig;
  allowLegacySupportMetadata?: boolean;
}

function validateBoundsAndOverlap(
  input: PersistedConstructionPlacementValidationInput,
): { valid: boolean; reason: string | null } {
  const { piece, placed, piecesById, worldCells, config } = input;
  if (!isFiniteConstructionPosition(placed.position)) return { valid: false, reason: "invalid position" };

  if (!config.unboundedWorld) {
    if (!Number.isFinite(worldCells) || worldCells <= 0) return { valid: false, reason: "invalid position" };
    const worldBounds = constructionBoundsFor(piece, placed.position, placed.rotationQuarterTurns);
    if (worldBounds.minX < 0 || worldBounds.maxX > worldCells || worldBounds.minZ < 0 || worldBounds.maxZ > worldCells) {
      return { valid: false, reason: "outside world" };
    }
  }

  for (const other of input.overlapCandidates ?? input.placedPieces) {
    const otherPiece = piecesById.get(other.typeId);
    if (!otherPiece) continue;
    if (constructionPiecesOverlap({
      piece,
      position: placed.position,
      rotationQuarterTurns: placed.rotationQuarterTurns,
      otherPiece,
      other,
      insetM: config.overlapPaddingM,
    })) return { valid: false, reason: "overlap" };
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
  if (placed.unsupported === true) return { valid: true, reason: null };
  if (placed.grounded === true) {
    return piece.canGround ? { valid: true, reason: null } : { valid: false, reason: "invalid support" };
  }
  const parentIds = placed.parentIds ?? [];
  if (parentIds.some((parentId) => isPlacedPieceSupported(placedPieces, parentId))) return { valid: true, reason: null };
  return { valid: false, reason: "unsupported" };
}

export function validateStrictPersistedConstructionPlacement(
  input: PersistedConstructionPlacementValidationInput,
): { valid: boolean; reason: string | null } {
  const support = validatePersistedSupport(
    input.piece,
    input.placed,
    input.placedPieces,
    input.allowLegacySupportMetadata ?? false,
  );
  return support.valid ? validateBoundsAndOverlap(input) : support;
}
