import type { ConstructionSnapResult, PlacedConstructionPiece } from "./types.js";

const MAX_SUPPORT_DEPTH = 64;

export interface ConstructionSupportResult {
  supported: boolean;
  grounded: boolean;
  parentIds: readonly string[];
  reason: string | null;
}

export interface ConstructionSupportInput {
  snapped: boolean;
  snap: ConstructionSnapResult | null;
  terrainGrounded: boolean;
  placedPieces: readonly PlacedConstructionPiece[];
}

export function buildPlacedPieceMap(placedPieces: readonly PlacedConstructionPiece[]): ReadonlyMap<string, PlacedConstructionPiece> {
  const byId = new Map<string, PlacedConstructionPiece>();
  for (const piece of placedPieces) byId.set(piece.id, piece);
  return byId;
}

export function hasGroundSupport(
  piece: PlacedConstructionPiece,
  piecesById: ReadonlyMap<string, PlacedConstructionPiece>,
  visiting: ReadonlySet<string> = new Set(),
  depth = 0,
): boolean {
  if (piece.grounded === true) return true;
  if (depth >= MAX_SUPPORT_DEPTH || visiting.has(piece.id)) return false;
  const parents = piece.parentIds ?? [];
  if (parents.length === 0) return false;

  const nextVisiting = new Set(visiting);
  nextVisiting.add(piece.id);
  return parents.some((parentId) => {
    const parent = piecesById.get(parentId);
    return parent ? hasGroundSupport(parent, piecesById, nextVisiting, depth + 1) : false;
  });
}

export function isPlacedPieceSupported(placedPieces: readonly PlacedConstructionPiece[], pieceId: string): boolean {
  const piecesById = buildPlacedPieceMap(placedPieces);
  const piece = piecesById.get(pieceId);
  return piece ? hasGroundSupport(piece, piecesById) : false;
}

export function resolveConstructionPlacementSupport(input: ConstructionSupportInput): ConstructionSupportResult {
  if (!input.snapped) {
    return input.terrainGrounded
      ? { supported: true, grounded: true, parentIds: [], reason: null }
      : { supported: false, grounded: false, parentIds: [], reason: "no support" };
  }

  const parentId = input.snap?.target.entityId;
  if (!parentId) {
    return { supported: false, grounded: false, parentIds: [], reason: "missing support" };
  }

  return isPlacedPieceSupported(input.placedPieces, parentId)
    ? { supported: true, grounded: false, parentIds: [parentId], reason: null }
    : { supported: false, grounded: false, parentIds: [parentId], reason: "unsupported" };
}
