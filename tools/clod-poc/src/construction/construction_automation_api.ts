import { surfaceHeight } from "../terrain/terrain.js";
import { constructionMaterialLabel } from "./materials.js";
import { createConstructionCandidate, createFreePlacementPosition } from "./placement.js";
import { ENTITY_ID_PREFIX, normalizeRotationQuarterTurns } from "./construction_controller_support.js";
import type {
  ConstructionCandidate,
  ConstructionConfig,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionTerrainConformHandler,
  PlacedConstructionPiece,
} from "./types.js";
import type { ConstructionOverlapIndex } from "./overlap_index.js";
import type { ConstructionPieceStore } from "./construction_piece_store.js";
import { createConstructionTerrainConformRequest } from "./construction_terrain_conform.js";
import {
  commitConstructionPlacementTransaction,
  type ConstructionPlacementUndoRecord,
} from "./construction_placement_transaction.js";
import { applyConstructionCommitAuthority, validateConstructionPlaceCommand } from "./construction_placement_session.js";
import type { PlayerEditAuthorityConfig, PlayerEditAuthorityPoint } from "../player/player_edit_authority.js";
import type { EditCommandDenialReason } from "../player/edit_commands.js";

export interface ConstructionPlacePieceAtInput {
  readonly position: readonly [number, number, number];
  readonly typeId?: string;
  readonly rotationQuarterTurns?: number;
  readonly material?: ConstructionMaterial;
}

export interface ConstructionPlacePieceAtResult {
  readonly ok: boolean;
  readonly pieceId: string | null;
  readonly reason: string | null;
}

export interface ConstructionBreakPieceInput {
  readonly pieceId?: string;
  readonly position?: readonly [number, number, number];
  readonly maxDistanceM?: number;
}

export interface ConstructionBreakPieceResult {
  readonly ok: boolean;
  readonly pieceId: string | null;
  readonly reason: string | null;
}

export interface ConstructionListedPiece {
  readonly id: string;
  readonly typeId: string;
  readonly position: readonly [number, number, number];
}

export function listConstructionPlacedPieces(
  pieces: readonly PlacedConstructionPiece[],
  limit = 256,
): readonly ConstructionListedPiece[] {
  const max = Math.max(0, Math.floor(limit));
  const out: ConstructionListedPiece[] = [];
  for (let i = 0; i < pieces.length && out.length < max; i += 1) {
    const piece = pieces[i]!;
    out.push({
      id: piece.id,
      typeId: piece.typeId,
      position: [...piece.position],
    });
  }
  return out;
}

export function findNearestConstructionPieceId(
  pieces: readonly PlacedConstructionPiece[],
  position: readonly [number, number, number],
  maxDistanceM = 4,
): string | null {
  const maxDist = Math.max(0.5, maxDistanceM);
  const maxDist2 = maxDist * maxDist;
  let bestDist2 = maxDist2;
  let targetId: string | null = null;
  for (const piece of pieces) {
    const dx = piece.position[0] - position[0];
    const dy = piece.position[1] - position[1];
    const dz = piece.position[2] - position[2];
    const dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 <= bestDist2) {
      bestDist2 = dist2;
      targetId = piece.id;
    }
  }
  return targetId;
}

export interface ConstructionAutomationBreakHost {
  placementInFlight: boolean;
  pieces: readonly PlacedConstructionPiece[];
  forgetUndoRecord: (pieceId: string) => void;
  removeOne: (pieceId: string) => { removedCount: number; disconnectedNeighborIds: readonly string[] };
  recomputeStability: (dirtyIds: Iterable<string>) => void;
  clearCurrentPreview: (resetSelector: boolean) => void;
  savePlacedPieces: () => void;
  setLastPlacementMessage: (message: string) => void;
  syncUi: (force?: boolean) => void;
}

export function breakConstructionPiece(
  host: ConstructionAutomationBreakHost,
  input: ConstructionBreakPieceInput,
): ConstructionBreakPieceResult {
  if (host.placementInFlight) {
    return { ok: false, pieceId: null, reason: "placement in flight" };
  }
  let targetId = input.pieceId ?? null;
  if (!targetId && input.position) {
    targetId = findNearestConstructionPieceId(host.pieces, input.position, input.maxDistanceM ?? 4);
  }
  if (!targetId) return { ok: false, pieceId: null, reason: "piece not found" };
  host.forgetUndoRecord(targetId);
  const removal = host.removeOne(targetId);
  if (removal.removedCount !== 1) {
    return { ok: false, pieceId: targetId, reason: "delete target was not tracked" };
  }
  host.recomputeStability(removal.disconnectedNeighborIds);
  host.clearCurrentPreview(true);
  host.savePlacedPieces();
  host.setLastPlacementMessage("Deleted 1 piece. Stability recomputed.");
  host.syncUi(true);
  return { ok: true, pieceId: targetId, reason: null };
}

export interface ConstructionAutomationPlaceHost {
  placementInFlight: boolean;
  setPlacementInFlight: (value: boolean) => void;
  config: ConstructionConfig;
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  pieceStore: ConstructionPieceStore;
  overlapIndex: ConstructionOverlapIndex;
  worldCells: number;
  nextEntityId: number;
  bumpNextEntityId: () => void;
  undoStack: ConstructionPlacementUndoRecord[];
  editAuthority?: PlayerEditAuthorityConfig;
  getAuthorityOrigin?: () => PlayerEditAuthorityPoint | null;
  getAuthorityCounters?: () => Record<string, number> | null;
  constructionReadyAt?: (x: number, z: number) => boolean;
  getTerrainRevision?: () => number;
  getInteractionMode?: () => string;
  recordEditDenial?: (reason: EditCommandDenialReason) => void;
  resolveTerrainConformHandler: () => ConstructionTerrainConformHandler | null;
  applyCommitAuthority?: (candidate: ConstructionCandidate) => ConstructionCandidate;
  recomputeStability: (dirtyIds: Iterable<string>) => void;
  clearCurrentPreview: (resetSelector: boolean) => void;
  savePlacedPieces: () => void;
  setLastPlacementMessage: (message: string) => void;
  syncUi: (force?: boolean) => void;
}

export async function placeConstructionPieceAt(
  host: ConstructionAutomationPlaceHost,
  input: ConstructionPlacePieceAtInput,
): Promise<ConstructionPlacePieceAtResult> {
  if (host.placementInFlight) {
    return { ok: false, pieceId: null, reason: "placement in flight" };
  }
  if (host.config.pieces.length === 0) {
    return { ok: false, pieceId: null, reason: "no construction pieces configured" };
  }
  const typeId = input.typeId
    ?? host.config.pieces.find((piece) => piece.canGround)?.id
    ?? host.config.pieces[0]!.id;
  const piece = host.piecesById.get(typeId);
  if (!piece) return { ok: false, pieceId: null, reason: `unknown piece type: ${typeId}` };
  const material = input.material ?? piece.material;
  const rotationQuarterTurns = normalizeRotationQuarterTurns(input.rotationQuarterTurns ?? 0);
  const surfaceY = surfaceHeight(input.position[0], input.position[2]);
  const terrainHit = {
    point: [input.position[0], surfaceY, input.position[2]] as const,
    normal: [0, 1, 0] as const,
    distanceM: 0,
    surfaceType: "terrain" as const,
  };
  const position = createFreePlacementPosition(piece, terrainHit, rotationQuarterTurns);
  const overlapCandidates = host.overlapIndex.query(piece, position, rotationQuarterTurns);
  const applyAuthority = host.applyCommitAuthority
    ?? ((candidate: ConstructionCandidate) => applyConstructionCommitAuthority({
      candidate,
      editAuthority: host.editAuthority,
      getAuthorityOrigin: host.getAuthorityOrigin,
      getAuthorityCounters: host.getAuthorityCounters,
      constructionReadyAt: host.constructionReadyAt,
    }));
  let candidate = applyAuthority(createConstructionCandidate({
    piece,
    material,
    position,
    rotationQuarterTurns,
    snapped: false,
    snap: null,
    connectionIds: [],
    terrainHit,
    placedPieces: host.pieceStore.pieces,
    overlapCandidates,
    piecesById: host.piecesById,
    worldCells: host.worldCells,
    config: host.config.placement,
    stabilityConfig: host.config.stability,
    supportProfiles: host.config.supportProfiles,
  }));
  if (!candidate.valid) {
    return { ok: false, pieceId: null, reason: candidate.reason ?? "invalid placement" };
  }
  const commandVerdict = validateConstructionPlaceCommand({
    candidate,
    command: null,
    getTerrainRevision: host.getTerrainRevision,
    getInteractionMode: host.getInteractionMode,
    getAuthorityOrigin: host.getAuthorityOrigin,
    editAuthority: host.editAuthority,
    constructionReadyAt: host.constructionReadyAt,
    recordEditDenial: host.recordEditDenial,
  });
  if (!commandVerdict.allowed) {
    return { ok: false, pieceId: null, reason: commandVerdict.reason };
  }
  const terrainRequest = createConstructionTerrainConformRequest(candidate, host.config.terrainConform);
  const handler = host.resolveTerrainConformHandler();
  if (terrainRequest) {
    if (!handler) return { ok: false, pieceId: null, reason: "terrain conform service unavailable" };
    const terrainPreview = handler.preview(terrainRequest);
    if (!terrainPreview.valid) {
      return { ok: false, pieceId: null, reason: terrainPreview.reason ?? "terrain conform preview rejected" };
    }
  }

  const placed: PlacedConstructionPiece = {
    id: `${ENTITY_ID_PREFIX}${host.nextEntityId}`,
    typeId: candidate.piece.id,
    position: [...candidate.position],
    rotationQuarterTurns: candidate.rotationQuarterTurns,
    material: candidate.material,
    grounded: candidate.stabilityGrounded,
    connectionIds: [...candidate.connectionIds],
    stability: candidate.stabilityValue,
  };
  host.setPlacementInFlight(true);
  try {
    const result = await commitConstructionPlacementTransaction({
      piece: placed,
      terrainRequest,
      terrainHandler: handler,
      addPiece: (next) => host.pieceStore.add(next, true),
    });
    if (!result.committed || !result.undoRecord) {
      return { ok: false, pieceId: null, reason: result.reason ?? "transaction rejected" };
    }
    host.bumpNextEntityId();
    host.undoStack.push(result.undoRecord);
    host.recomputeStability([placed.id, ...(placed.connectionIds ?? [])]);
    host.savePlacedPieces();
    host.clearCurrentPreview(true);
    host.setLastPlacementMessage(constructionPlaceSuccessMessage(candidate));
    return {
      ok: true,
      pieceId: placed.id,
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      pieceId: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    host.setPlacementInFlight(false);
    host.syncUi(true);
  }
}

/** Convenience for message text after a successful automation place. */
export function constructionPlaceSuccessMessage(candidate: ConstructionCandidate): string {
  return `Placed ${candidate.piece.label} · ${constructionMaterialLabel(candidate.material)}`;
}
