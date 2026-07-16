import {
  constructionBoundsFor,
  constructionBoundsOverlap,
  isFiniteConstructionPosition,
  rotatedConstructionDimensions,
} from "./construction_bounds.js";
import { resolveConstructionPlacementSupport } from "./support_state.js";
import type {
  ConstructionCandidate,
  ConstructionPieceDef,
  ConstructionPlacementConfig,
  ConstructionSnapResult,
  PlacedConstructionPiece,
} from "./types.js";

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
  overlapCandidates?: readonly PlacedConstructionPiece[];
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  worldCells: number;
  config: ConstructionPlacementConfig;
}

function validateBoundsAndOverlap(input: PlacementValidationInput): { valid: boolean; reason: string | null } {
  const { piece, position, rotationQuarterTurns, piecesById, worldCells, config } = input;
  if (!isFiniteConstructionPosition(position)) return { valid: false, reason: "invalid position" };

  if (!config.unboundedWorld) {
    if (!Number.isFinite(worldCells) || worldCells <= 0) return { valid: false, reason: "invalid position" };
    const worldBounds = constructionBoundsFor(piece, position, rotationQuarterTurns);
    if (worldBounds.minX < 0 || worldBounds.maxX > worldCells || worldBounds.minZ < 0 || worldBounds.maxZ > worldCells) {
      return { valid: false, reason: "outside world" };
    }
  }

  const bounds = constructionBoundsFor(piece, position, rotationQuarterTurns, config.overlapPaddingM);
  const candidates = input.overlapCandidates ?? input.placedPieces;
  for (const placed of candidates) {
    const otherPiece = piecesById.get(placed.typeId);
    if (!otherPiece) continue;
    const otherBounds = constructionBoundsFor(
      otherPiece,
      placed.position,
      placed.rotationQuarterTurns,
      config.overlapPaddingM,
    );
    if (constructionBoundsOverlap(bounds, otherBounds)) return { valid: false, reason: "overlap" };
  }
  return { valid: true, reason: null };
}

function resolveSupport(input: PlacementValidationInput) {
  return resolveConstructionPlacementSupport({
    snapped: input.snapped,
    snap: input.snap,
    terrainGrounded: input.piece.canGround && !input.snapped && input.terrainHit !== null,
    placedPieces: input.placedPieces,
  });
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
  if (!input.snapped && !input.piece.canGround) return { valid: false, reason: "snap required" };
  if (input.piece.canGround && !input.snapped && !input.terrainHit) return { valid: false, reason: "no terrain" };

  const support = resolveSupport(input);
  if (!support.supported) return { valid: false, reason: support.reason ?? "unsupported" };
  return validateBoundsAndOverlap(input);
}

export function createConstructionCandidate(input: PlacementValidationInput): ConstructionCandidate {
  const validation = validateConstructionPlacement(input);
  const support = resolveSupport(input);
  return {
    piece: input.piece,
    position: input.position,
    rotationQuarterTurns: input.rotationQuarterTurns,
    snapped: input.snapped,
    valid: validation.valid,
    reason: validation.reason,
    snap: input.snap,
    supportState: support.grounded ? "grounded" : support.supported ? "connected" : "unsupported",
    supportParentIds: support.parentIds,
  };
}

export const constructionPlacementMath = {
  rotatedDimensions: rotatedConstructionDimensions,
};
