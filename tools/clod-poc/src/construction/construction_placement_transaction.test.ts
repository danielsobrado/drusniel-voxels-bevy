import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeConstructionRemoval,
  installConstructionRemoveAuthorizer,
} from "./construction_remove_authority.js";
import {
  commitConstructionPlacementTransaction,
  undoConstructionPlacementTransaction,
} from "./construction_placement_transaction.js";
import type {
  ConstructionTerrainConformHandler,
  ConstructionTerrainConformRequest,
  PlacedConstructionPiece,
} from "./types.js";

const piece: PlacedConstructionPiece = {
  id: "piece-1",
  typeId: "foundation",
  position: [0, 0, 0],
  rotationQuarterTurns: 0,
};
const request = { pieceId: "foundation" } as ConstructionTerrainConformRequest;

let disposeAuthorizer: (() => void) | null = null;

afterEach(() => {
  disposeAuthorizer?.();
  disposeAuthorizer = null;
});

function handler(overrides: Partial<ConstructionTerrainConformHandler> = {}): ConstructionTerrainConformHandler {
  return {
    preview: vi.fn(),
    commit: vi.fn(async () => ({ committed: true, reason: null, changed: true, receipt: { id: "receipt" } })),
    undo: vi.fn(async () => ({ undone: true, reason: null })),
    ...overrides,
  };
}

describe("construction placement transaction", () => {
  it("does not add a piece when terrain commit fails", async () => {
    const terrain = handler({
      commit: vi.fn(async () => ({ committed: false, reason: "not ready", changed: false, receipt: null })),
    });
    const addPiece = vi.fn(() => true);
    const result = await commitConstructionPlacementTransaction({ piece, terrainRequest: request, terrainHandler: terrain, addPiece });
    expect(result.committed).toBe(false);
    expect(addPiece).not.toHaveBeenCalled();
  });

  it("compensates terrain when adding the piece fails", async () => {
    const terrain = handler();
    const result = await commitConstructionPlacementTransaction({
      piece,
      terrainRequest: request,
      terrainHandler: terrain,
      addPiece: () => false,
    });
    expect(result.committed).toBe(false);
    expect(terrain.undo).toHaveBeenCalledWith({ id: "receipt" });
  });

  it("restores the piece when terrain undo fails", async () => {
    const terrain = handler({ undo: vi.fn(async () => ({ undone: false, reason: "terrain changed" })) });
    const restorePiece = vi.fn(() => true);
    const result = await undoConstructionPlacementTransaction({
      record: { piece, terrainReceipt: { id: "receipt" } },
      terrainHandler: terrain,
      removePiece: () => true,
      restorePiece,
    });
    expect(result.undone).toBe(false);
    expect(restorePiece).toHaveBeenCalledWith(piece);
  });

  it("preserves the piece and terrain receipt when removal authority denies undo", async () => {
    const removePiece = vi.fn(() => true);
    const terrain = handler();
    disposeAuthorizer = installConstructionRemoveAuthorizer(() => ({
      allowed: false,
      reason: "out_of_range",
    }));

    expect(authorizeConstructionRemoval(piece)).toEqual({
      allowed: false,
      reason: "out_of_range",
    });
    const result = await undoConstructionPlacementTransaction({
      record: { piece, terrainReceipt: { id: "receipt" } },
      terrainHandler: terrain,
      removePiece,
      restorePiece: vi.fn(() => true),
    });

    expect(result).toEqual({
      undone: false,
      reason: "edit command denied: out_of_range",
    });
    expect(removePiece).not.toHaveBeenCalled();
    expect(terrain.undo).not.toHaveBeenCalled();
  });
});
