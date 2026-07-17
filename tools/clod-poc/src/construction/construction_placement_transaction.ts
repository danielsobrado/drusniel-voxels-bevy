import type {
  ConstructionTerrainConformHandler,
  ConstructionTerrainConformReceipt,
  ConstructionTerrainConformRequest,
  PlacedConstructionPiece,
} from "./types.js";

export interface ConstructionPlacementUndoRecord {
  piece: PlacedConstructionPiece;
  terrainReceipt: ConstructionTerrainConformReceipt | null;
}

export interface CommitConstructionPlacementInput {
  piece: PlacedConstructionPiece;
  terrainRequest: ConstructionTerrainConformRequest | null;
  terrainHandler: ConstructionTerrainConformHandler | null;
  addPiece(piece: PlacedConstructionPiece): boolean;
}

export interface CommitConstructionPlacementResult {
  committed: boolean;
  reason: string | null;
  undoRecord: ConstructionPlacementUndoRecord | null;
}

export async function commitConstructionPlacementTransaction(
  input: CommitConstructionPlacementInput,
): Promise<CommitConstructionPlacementResult> {
  let terrainReceipt: ConstructionTerrainConformReceipt | null = null;
  if (input.terrainRequest) {
    if (!input.terrainHandler) {
      return { committed: false, reason: "terrain conform service unavailable", undoRecord: null };
    }
    const terrainResult = await input.terrainHandler.commit(input.terrainRequest);
    if (!terrainResult.committed) {
      return {
        committed: false,
        reason: terrainResult.reason ?? "terrain conform failed",
        undoRecord: null,
      };
    }
    terrainReceipt = terrainResult.receipt;
  }

  let added = false;
  try {
    added = input.addPiece(input.piece);
  } catch (error) {
    if (terrainReceipt && input.terrainHandler) await input.terrainHandler.undo(terrainReceipt);
    throw error;
  }
  if (!added) {
    let compensationReason: string | null = null;
    if (terrainReceipt && input.terrainHandler) {
      const compensation = await input.terrainHandler.undo(terrainReceipt);
      if (!compensation.undone) compensationReason = compensation.reason ?? "terrain rollback failed";
    }
    return {
      committed: false,
      reason: compensationReason
        ? `piece add failed; ${compensationReason}`
        : "piece add failed",
      undoRecord: null,
    };
  }

  return {
    committed: true,
    reason: null,
    undoRecord: {
      piece: {
        ...input.piece,
        position: [...input.piece.position],
        connectionIds: input.piece.connectionIds ? [...input.piece.connectionIds] : undefined,
      },
      terrainReceipt,
    },
  };
}

export interface UndoConstructionPlacementInput {
  record: ConstructionPlacementUndoRecord;
  terrainHandler: ConstructionTerrainConformHandler | null;
  removePiece(id: string): boolean;
  restorePiece(piece: PlacedConstructionPiece): boolean;
}

export interface UndoConstructionPlacementResult {
  undone: boolean;
  reason: string | null;
}

export async function undoConstructionPlacementTransaction(
  input: UndoConstructionPlacementInput,
): Promise<UndoConstructionPlacementResult> {
  if (!input.removePiece(input.record.piece.id)) {
    return { undone: false, reason: "piece is no longer present" };
  }

  const receipt = input.record.terrainReceipt;
  if (!receipt) return { undone: true, reason: null };
  if (!input.terrainHandler) {
    input.restorePiece(input.record.piece);
    return { undone: false, reason: "terrain conform service unavailable" };
  }

  const terrainResult = await input.terrainHandler.undo(receipt);
  if (terrainResult.undone) return { undone: true, reason: null };
  const restored = input.restorePiece(input.record.piece);
  return {
    undone: false,
    reason: restored
      ? terrainResult.reason ?? "terrain undo failed"
      : `${terrainResult.reason ?? "terrain undo failed"}; piece restore also failed`,
  };
}
