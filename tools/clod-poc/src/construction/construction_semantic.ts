import type { PlacedConstructionPiece } from "./types.js";

/** Canonical construction state for semantic (not byte-order) equivalence. */
export interface CanonicalConstructionPiece {
  readonly id: string;
  readonly typeId: string;
  readonly position: readonly [number, number, number];
  readonly rotationQuarterTurns: number;
  readonly material: string | null;
  readonly grounded: boolean | null;
  readonly connectionIds: readonly string[];
  readonly stability: number | null;
  readonly unsupported: boolean;
}

export function canonicalConstructionPieces(
  pieces: readonly PlacedConstructionPiece[],
): CanonicalConstructionPiece[] {
  return pieces.map((piece) => ({
    id: piece.id,
    typeId: piece.typeId,
    position: [...piece.position] as [number, number, number],
    rotationQuarterTurns: piece.rotationQuarterTurns,
    material: piece.material ?? null,
    grounded: piece.grounded ?? null,
    connectionIds: [...(piece.connectionIds ?? piece.parentIds ?? [])].sort(),
    stability: piece.stability ?? null,
    unsupported: piece.unsupported === true,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function constructionSemanticEqual(
  left: readonly PlacedConstructionPiece[],
  right: readonly PlacedConstructionPiece[],
): boolean {
  return JSON.stringify(canonicalConstructionPieces(left))
    === JSON.stringify(canonicalConstructionPieces(right));
}
