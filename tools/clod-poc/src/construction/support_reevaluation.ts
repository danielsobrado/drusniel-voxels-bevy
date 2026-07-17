import { constructionBoundsFor, rotatedConstructionDimensions } from "./construction_bounds.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

const GROUND_PROBE_DEPTH_M = 0.5;
const GROUND_PROBE_CORNER_INSET_M = 0.25;

export interface ConstructionSupportAabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type ConstructionGroundSolidProbe = (x: number, y: number, z: number) => boolean;

export interface ConstructionSupportReevaluationInput {
  pieces: readonly PlacedConstructionPiece[];
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  aabb: ConstructionSupportAabb;
  groundSolidAt: ConstructionGroundSolidProbe;
}

export interface ConstructionSupportReevaluationResult {
  changed: boolean;
  groundedLost: readonly string[];
  groundedRestored: readonly string[];
  dirtyIds: readonly string[];
}

function boundsIntersectAabb(piece: ConstructionPieceDef, placed: PlacedConstructionPiece, aabb: ConstructionSupportAabb): boolean {
  const bounds = constructionBoundsFor(piece, placed.position, placed.rotationQuarterTurns);
  return bounds.minX <= aabb.maxX && bounds.maxX >= aabb.minX
    && bounds.minZ <= aabb.maxZ && bounds.maxZ >= aabb.minZ;
}

function probeTerrainSupport(
  piece: ConstructionPieceDef,
  placed: PlacedConstructionPiece,
  groundSolidAt: ConstructionGroundSolidProbe,
): boolean {
  const [sx, sy, sz] = rotatedConstructionDimensions(piece, placed.rotationQuarterTurns);
  const [cx, cy, cz] = placed.position;
  const probeY = cy - sy * 0.5 - GROUND_PROBE_DEPTH_M;
  const hx = Math.max(0, sx * 0.5 - GROUND_PROBE_CORNER_INSET_M);
  const hz = Math.max(0, sz * 0.5 - GROUND_PROBE_CORNER_INSET_M);
  return groundSolidAt(cx, probeY, cz)
    || groundSolidAt(cx - hx, probeY, cz - hz)
    || groundSolidAt(cx + hx, probeY, cz - hz)
    || groundSolidAt(cx - hx, probeY, cz + hz)
    || groundSolidAt(cx + hx, probeY, cz + hz);
}

function isGroundRegainCandidate(piece: ConstructionPieceDef, placed: PlacedConstructionPiece): boolean {
  return piece.canGround
    && placed.grounded !== true
    && (placed.connectionIds ?? placed.parentIds ?? []).length === 0;
}

/**
 * Re-probes only terrain grounding. Structural propagation belongs to the dirty-island
 * runtime, which receives dirtyIds and recomputes the affected connected component.
 */
export function reevaluateConstructionSupport(input: ConstructionSupportReevaluationInput): ConstructionSupportReevaluationResult {
  const groundedLost: string[] = [];
  const groundedRestored: string[] = [];

  for (const placed of input.pieces) {
    const piece = input.piecesById.get(placed.typeId);
    if (!piece || !boundsIntersectAabb(piece, placed, input.aabb)) continue;
    const claimsGround = placed.grounded === true;
    if (!claimsGround && !isGroundRegainCandidate(piece, placed)) continue;
    const solid = probeTerrainSupport(piece, placed, input.groundSolidAt);
    if (claimsGround && !solid) groundedLost.push(placed.id);
    else if (!claimsGround && solid) groundedRestored.push(placed.id);
  }

  return {
    changed: groundedLost.length > 0 || groundedRestored.length > 0,
    groundedLost,
    groundedRestored,
    dirtyIds: [...new Set([...groundedLost, ...groundedRestored])].sort(),
  };
}
