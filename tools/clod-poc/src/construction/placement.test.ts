import { describe, expect, it } from "vitest";
import { createConstructionCandidate, createFreePlacementPosition, validateConstructionPlacement } from "./placement.js";
import type { ConstructionPieceDef, ConstructionPlacementConfig, PlacedConstructionPiece } from "./types.js";

const placementConfig: ConstructionPlacementConfig = {
  maxRayDistanceM: 100,
  terrainStepM: 1,
  overlapPaddingM: 0.04,
  storageKey: "test-construction",
};

const floor: ConstructionPieceDef = {
  id: "floor",
  label: "Floor",
  category: "floor",
  dimensionsM: [2, 0.2, 2],
  canGround: true,
  material: "wood",
  snapPoints: [],
};

const wall: ConstructionPieceDef = {
  id: "wall",
  label: "Wall",
  category: "wall",
  dimensionsM: [2, 2, 0.2],
  canGround: false,
  material: "wood",
  snapPoints: [],
};

function validate(
  piece: ConstructionPieceDef,
  position: readonly [number, number, number],
  placedPieces: readonly PlacedConstructionPiece[] = [],
): { valid: boolean; reason: string | null } {
  return validateConstructionPlacement({
    piece,
    position,
    rotationQuarterTurns: 0,
    snapped: piece.canGround,
    snap: null,
    terrainHit: piece.canGround ? { point: [position[0], 0, position[2]], distanceM: 1 } : null,
    placedPieces,
    piecesById: new Map([[floor.id, floor], [wall.id, wall]]),
    worldCells: 16,
    config: placementConfig,
  });
}

describe("construction placement", () => {
  it("places grounded pieces on top of terrain", () => {
    expect(createFreePlacementPosition(floor, { point: [4, 3, 5], distanceM: 10 })).toEqual([4, 3.1, 5]);
  });

  it("rejects pieces that extend outside the world even when their center is inside", () => {
    expect(validate(floor, [0.5, 1, 8])).toEqual({ valid: false, reason: "outside world" });
  });

  it("rejects duplicate overlapping placements", () => {
    const placed: PlacedConstructionPiece = {
      id: "piece-1",
      typeId: "floor",
      position: [8, 1, 8],
      rotationQuarterTurns: 0,
    };

    expect(validate(floor, [8, 1, 8], [placed])).toEqual({ valid: false, reason: "overlap" });
  });

  it("keeps candidate rotation from the validated input", () => {
    const candidate = createConstructionCandidate({
      piece: wall,
      position: [8, 2, 8],
      rotationQuarterTurns: 3,
      snapped: true,
      snap: null,
      terrainHit: null,
      placedPieces: [],
      piecesById: new Map([[wall.id, wall]]),
      worldCells: 16,
      config: placementConfig,
    });

    expect(candidate.valid).toBe(true);
    expect(candidate.rotationQuarterTurns).toBe(3);
  });
});
