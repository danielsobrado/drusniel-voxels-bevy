import { constructionBoundsFor, rotatedConstructionDimensions } from "./construction_bounds.js";
import { buildPlacedPieceMap, hasGroundSupport } from "./support_state.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

/** Depth below the piece base sampled for terrain support (dug holes are metres deep). */
const GROUND_PROBE_DEPTH_M = 0.5;
/** Corner probes are inset so a piece flush with a hole edge still counts its rim. */
const GROUND_PROBE_CORNER_INSET_M = 0.25;

export interface ConstructionSupportAabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Answers "is there solid ground at this point?" against the authoritative voxel-aware
 * density field — NOT a collider raycast, which is stale while the async rebuild
 * pipeline is still replacing the dug page.
 */
export type ConstructionGroundSolidProbe = (x: number, y: number, z: number) => boolean;

export interface ConstructionSupportReevaluationInput {
  pieces: readonly PlacedConstructionPiece[];
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  aabb: ConstructionSupportAabb;
  groundSolidAt: ConstructionGroundSolidProbe;
}

export interface ConstructionSupportReevaluationResult {
  changed: boolean;
  /** Pieces whose terrain grounding flipped true→false in this pass. */
  groundedLost: readonly string[];
  /** Pieces whose terrain grounding was restored (terrain raised back). */
  groundedRestored: readonly string[];
  /** The complete set of unsupported pieces after chain re-evaluation. */
  unsupportedIds: ReadonlySet<string>;
}

function boundsIntersectAabb(
  piece: ConstructionPieceDef,
  placed: PlacedConstructionPiece,
  aabb: ConstructionSupportAabb,
): boolean {
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

/** A ground-lost piece: explicitly unsupported, terrain-groundable, with no parents. */
function isGroundRegainCandidate(piece: ConstructionPieceDef, placed: PlacedConstructionPiece): boolean {
  return placed.unsupported === true
    && piece.canGround
    && placed.grounded !== true
    && (placed.parentIds ?? []).length === 0;
}

/**
 * Re-evaluates construction support after a terrain edit. Grounded pieces whose
 * footprint intersects the edited AABB are re-probed against the authoritative density
 * field; support then propagates through the parent chain, so digging under a
 * foundation marks the whole dependent structure unsupported (collapse stays deferred —
 * callers keep colliders aligned with the visible pieces). Raising terrain back under a
 * ground-lost piece restores it.
 */
export function reevaluateConstructionSupport(
  input: ConstructionSupportReevaluationInput,
): ConstructionSupportReevaluationResult {
  const groundedLost: string[] = [];
  const groundedRestored: string[] = [];

  for (const placed of input.pieces) {
    const piece = input.piecesById.get(placed.typeId);
    if (!piece) continue;
    const claimsGround = placed.grounded === true;
    const regainCandidate = isGroundRegainCandidate(piece, placed);
    if (!claimsGround && !regainCandidate) continue;
    if (!boundsIntersectAabb(piece, placed, input.aabb)) continue;
    const solid = probeTerrainSupport(piece, placed, input.groundSolidAt);
    if (claimsGround && !solid) groundedLost.push(placed.id);
    else if (regainCandidate && solid) groundedRestored.push(placed.id);
  }

  const lost = new Set(groundedLost);
  const restored = new Set(groundedRestored);
  const evaluated = input.pieces.map((placed) => {
    if (lost.has(placed.id)) return { ...placed, grounded: false };
    if (restored.has(placed.id)) return { ...placed, grounded: true };
    return placed;
  });
  const byId = buildPlacedPieceMap(evaluated);

  const unsupportedIds = new Set<string>();
  for (const placed of evaluated) {
    if (!hasGroundSupport(placed, byId)) unsupportedIds.add(placed.id);
  }

  const changed = groundedLost.length > 0
    || groundedRestored.length > 0
    || input.pieces.some((placed) => (placed.unsupported === true) !== unsupportedIds.has(placed.id));

  return { changed, groundedLost, groundedRestored, unsupportedIds };
}
