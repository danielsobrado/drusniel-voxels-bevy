import { constructionBoundsFor } from "./construction_bounds.js";
import type { ConstructionPieceDef, ConstructionVec3, PlacedConstructionPiece } from "./types.js";

const GROUND_PROBE_DEPTH_M = 0.10;
const GROUND_PROBE_INSET_RATIO = 0.80;

export interface ConstructionGroundingAabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type ConstructionGroundSolidProbe = (x: number, y: number, z: number) => boolean;

function intersectsAabb(
  piece: ConstructionPieceDef,
  placed: PlacedConstructionPiece,
  aabb: ConstructionGroundingAabb,
): boolean {
  const bounds = constructionBoundsFor(piece, placed.position, placed.rotationQuarterTurns);
  return bounds.minX <= aabb.maxX && bounds.maxX >= aabb.minX
    && bounds.minZ <= aabb.maxZ && bounds.maxZ >= aabb.minZ;
}

export function isConstructionPieceGrounded(input: {
  piece: ConstructionPieceDef;
  position: ConstructionVec3;
  rotationQuarterTurns: number;
  groundSolidAt: ConstructionGroundSolidProbe;
}): boolean {
  if (!input.piece.canGround) return false;
  const bounds = constructionBoundsFor(input.piece, input.position, input.rotationQuarterTurns);
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const halfX = (bounds.maxX - bounds.minX) * 0.5 * GROUND_PROBE_INSET_RATIO;
  const halfZ = (bounds.maxZ - bounds.minZ) * 0.5 * GROUND_PROBE_INSET_RATIO;
  const y = bounds.minY - GROUND_PROBE_DEPTH_M;
  const samples: readonly ConstructionVec3[] = [
    [centerX, y, centerZ],
    [centerX - halfX, y, centerZ - halfZ],
    [centerX + halfX, y, centerZ - halfZ],
    [centerX - halfX, y, centerZ + halfZ],
    [centerX + halfX, y, centerZ + halfZ],
  ];
  return samples.some(([x, sampleY, z]) => input.groundSolidAt(x, sampleY, z));
}

export function refreshConstructionGrounding(input: {
  pieces: readonly PlacedConstructionPiece[];
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  groundSolidAt: ConstructionGroundSolidProbe;
  aabb?: ConstructionGroundingAabb;
}): readonly string[] {
  const changed: string[] = [];
  for (const placed of input.pieces) {
    const piece = input.piecesById.get(placed.typeId);
    if (!piece || (input.aabb && !intersectsAabb(piece, placed, input.aabb))) continue;
    const grounded = isConstructionPieceGrounded({
      piece,
      position: placed.position,
      rotationQuarterTurns: placed.rotationQuarterTurns,
      groundSolidAt: input.groundSolidAt,
    });
    if ((placed.grounded === true) === grounded) continue;
    placed.grounded = grounded;
    changed.push(placed.id);
  }
  return changed;
}
