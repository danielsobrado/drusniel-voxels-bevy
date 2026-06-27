import { describe, expect, it } from "vitest";
import { resolveConstructionPlacementSupport } from "./support_state.js";
import type { ConstructionSnapResult, PlacedConstructionPiece } from "./types.js";

function snapTo(entityId: string): ConstructionSnapResult {
  return {
    target: {
      entityId,
      pieceTypeId: "floor",
      snapIndex: 0,
      worldPos: [0, 0, 0],
      worldDirection: [1, 0, 0],
      group: "floor-edge",
      accepts: ["wall-bottom"],
    },
    sourceSnapIndex: 0,
    worldPosition: [0, 1, 0],
    rotationQuarterTurns: 0,
    score: 1,
  };
}

const groundedFloor: PlacedConstructionPiece = {
  id: "floor-1",
  typeId: "floor",
  position: [10, 5, 10],
  rotationQuarterTurns: 0,
  grounded: true,
  parentIds: [],
};

describe("construction support state", () => {
  it("grounds free terrain placements", () => {
    const support = resolveConstructionPlacementSupport({
      snapped: false,
      snap: null,
      terrainGrounded: true,
      placedPieces: [],
    });

    expect(support).toEqual({ supported: true, grounded: true, parentIds: [], reason: null });
  });

  it("connects snapped pieces to a supported parent", () => {
    const support = resolveConstructionPlacementSupport({
      snapped: true,
      snap: snapTo("floor-1"),
      terrainGrounded: false,
      placedPieces: [groundedFloor],
    });

    expect(support.supported).toBe(true);
    expect(support.grounded).toBe(false);
    expect(support.parentIds).toEqual(["floor-1"]);
  });

  it("rejects snapped pieces attached only to an unsupported chain", () => {
    const unsupportedWall: PlacedConstructionPiece = {
      id: "wall-1",
      typeId: "wall",
      position: [11, 6.1, 10],
      rotationQuarterTurns: 0,
      grounded: false,
      parentIds: ["missing-floor"],
    };

    const support = resolveConstructionPlacementSupport({
      snapped: true,
      snap: snapTo("wall-1"),
      terrainGrounded: false,
      placedPieces: [unsupportedWall],
    });

    expect(support.supported).toBe(false);
    expect(support.reason).toBe("unsupported");
  });

  it("treats runtime pieces without support metadata as unsupported", () => {
    const legacyWall: PlacedConstructionPiece = {
      id: "wall-legacy",
      typeId: "wall",
      position: [11, 6.1, 10],
      rotationQuarterTurns: 0,
    };

    const support = resolveConstructionPlacementSupport({
      snapped: true,
      snap: snapTo("wall-legacy"),
      terrainGrounded: false,
      placedPieces: [legacyWall],
    });

    expect(support.supported).toBe(false);
  });
});
