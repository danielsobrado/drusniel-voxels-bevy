import {
  constructionBoundsFor,
  isFiniteConstructionPosition,
  rotatedConstructionDimensions,
} from "./construction_bounds.js";
import { constructionPiecesOverlap } from "./construction_obb.js";
import { resolveConstructionPlacementSupport } from "./support_state.js";
import type {
  ConstructionCandidate,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionPlacementConfig,
  ConstructionSnapResult,
  ConstructionStabilityConfig,
  ConstructionSupportProfiles,
  ConstructionSurfaceHit,
  PlacedConstructionPiece,
} from "./types.js";

export type TerrainHitPoint = ConstructionSurfaceHit;

export interface PlacementValidationInput {
  piece: ConstructionPieceDef;
  material: ConstructionMaterial;
  position: readonly [number, number, number];
  rotationQuarterTurns: number;
  snapped: boolean;
  snap: ConstructionSnapResult | null;
  connectionIds: readonly string[];
  terrainHit: ConstructionSurfaceHit | null;
  placedPieces: readonly PlacedConstructionPiece[];
  overlapCandidates?: readonly PlacedConstructionPiece[];
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  worldCells: number;
  config: ConstructionPlacementConfig;
  stabilityConfig: ConstructionStabilityConfig;
  supportProfiles: ConstructionSupportProfiles;
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

  for (const placed of input.overlapCandidates ?? input.placedPieces) {
    const otherPiece = piecesById.get(placed.typeId);
    if (!otherPiece) continue;
    if (constructionPiecesOverlap({
      piece,
      position,
      rotationQuarterTurns,
      otherPiece,
      other: placed,
      insetM: config.overlapPaddingM,
    })) return { valid: false, reason: "overlap" };
  }
  return { valid: true, reason: null };
}

function resolveSupport(input: PlacementValidationInput) {
  return resolveConstructionPlacementSupport({
    snapped: input.snapped,
    terrainGrounded: input.piece.canGround && !input.snapped && input.terrainHit !== null,
    connectionIds: input.connectionIds,
    position: input.position,
    piece: input.piece,
    material: input.material,
    placedPieces: input.placedPieces,
    piecesById: input.piecesById,
    supportProfiles: input.supportProfiles,
    stabilityConfig: input.stabilityConfig,
  });
}

export function createFreePlacementPosition(
  piece: ConstructionPieceDef,
  terrainHit: ConstructionSurfaceHit,
  rotationQuarterTurns = 0,
): readonly [number, number, number] {
  const localBounds = constructionBoundsFor(piece, [0, 0, 0], rotationQuarterTurns);
  return [terrainHit.point[0], terrainHit.point[1] - localBounds.minY, terrainHit.point[2]];
}

export function validateConstructionPlacement(input: PlacementValidationInput): { valid: boolean; reason: string | null } {
  if (!input.snapped && !input.piece.canGround) return { valid: false, reason: "snap required" };
  if (input.piece.canGround && !input.snapped && !input.terrainHit) return { valid: false, reason: "no terrain" };
  if (!input.snapped && input.terrainHit && input.terrainHit.normal[1] < (input.piece.groundNormalMinY ?? 0.45)) {
    return { valid: false, reason: "surface too steep" };
  }

  const support = resolveSupport(input);
  if (!support.supported) return { valid: false, reason: support.reason ?? "unsupported" };
  return validateBoundsAndOverlap(input);
}

export function createConstructionCandidate(input: PlacementValidationInput): ConstructionCandidate {
  const validation = validateConstructionPlacement(input);
  const support = resolveSupport(input);
  return {
    piece: input.piece,
    material: input.material,
    position: input.position,
    rotationQuarterTurns: input.rotationQuarterTurns,
    snapped: input.snapped,
    valid: validation.valid,
    reason: validation.reason,
    snap: input.snap,
    terrainHit: input.terrainHit,
    supportState: support.grounded ? "grounded" : support.supported ? "connected" : "unsupported",
    connectionIds: support.connectionIds,
    stabilityValue: support.stabilityValue,
    stabilityMaxSupport: support.maxSupport,
    stabilityGrounded: support.grounded,
  };
}

export const constructionPlacementMath = { rotatedDimensions: rotatedConstructionDimensions };
