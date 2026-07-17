import {
  constructionSupportProfile,
  predictConstructionStability,
  shouldCollapseConstruction,
} from "./construction_stability.js";
import type {
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionStabilityConfig,
  ConstructionSupportProfiles,
  ConstructionVec3,
  PlacedConstructionPiece,
} from "./types.js";

const MAX_SUPPORT_DEPTH = 64;

export interface ConstructionSupportResult {
  supported: boolean;
  grounded: boolean;
  connectionIds: readonly string[];
  stabilityValue: number;
  maxSupport: number;
  reason: string | null;
}

export interface ConstructionSupportInput {
  snapped: boolean;
  terrainGrounded: boolean;
  connectionIds: readonly string[];
  position: ConstructionVec3;
  piece: ConstructionPieceDef;
  material: ConstructionMaterial;
  placedPieces: readonly PlacedConstructionPiece[];
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  supportProfiles: ConstructionSupportProfiles;
  stabilityConfig: ConstructionStabilityConfig;
}

export function buildPlacedPieceMap(placedPieces: readonly PlacedConstructionPiece[]): ReadonlyMap<string, PlacedConstructionPiece> {
  return new Map(placedPieces.map((piece) => [piece.id, piece]));
}

/** Legacy graph walk retained for v1 save migration. Runtime stability uses the undirected graph solver. */
export function hasGroundSupport(
  piece: PlacedConstructionPiece,
  piecesById: ReadonlyMap<string, PlacedConstructionPiece>,
  visiting: ReadonlySet<string> = new Set(),
  depth = 0,
): boolean {
  if (piece.grounded === true) return true;
  if (depth >= MAX_SUPPORT_DEPTH || visiting.has(piece.id)) return false;
  const connections = piece.connectionIds ?? piece.parentIds ?? [];
  if (connections.length === 0) return false;
  const nextVisiting = new Set(visiting);
  nextVisiting.add(piece.id);
  return connections.some((connectionId) => {
    const connected = piecesById.get(connectionId);
    return connected ? hasGroundSupport(connected, piecesById, nextVisiting, depth + 1) : false;
  });
}

export function isPlacedPieceSupported(placedPieces: readonly PlacedConstructionPiece[], pieceId: string): boolean {
  const piecesById = buildPlacedPieceMap(placedPieces);
  const piece = piecesById.get(pieceId);
  return piece ? hasGroundSupport(piece, piecesById) : false;
}

export function resolveConstructionPlacementSupport(input: ConstructionSupportInput): ConstructionSupportResult {
  const targetProfile = constructionSupportProfile(input.piece, input.material, input.supportProfiles);
  if (!input.snapped && !input.terrainGrounded) {
    return {
      supported: false,
      grounded: false,
      connectionIds: [],
      stabilityValue: 0,
      maxSupport: targetProfile.maxSupport,
      reason: "no support",
    };
  }
  if (input.snapped && input.connectionIds.length === 0) {
    return {
      supported: false,
      grounded: false,
      connectionIds: [],
      stabilityValue: 0,
      maxSupport: targetProfile.maxSupport,
      reason: "missing support",
    };
  }

  const grounded = input.terrainGrounded;
  const stabilityValue = predictConstructionStability({
    grounded,
    position: input.position,
    targetProfile,
    connectionIds: input.connectionIds,
    placedById: buildPlacedPieceMap(input.placedPieces),
    piecesById: input.piecesById,
    supportProfiles: input.supportProfiles,
    config: input.stabilityConfig,
  });
  const supported = !shouldCollapseConstruction(stabilityValue, grounded, input.stabilityConfig);
  return {
    supported,
    grounded,
    connectionIds: input.connectionIds,
    stabilityValue,
    maxSupport: targetProfile.maxSupport,
    reason: supported ? null : "insufficient stability",
  };
}
