import { describe, expect, it } from "vitest";
import { validateConstructionPlacement } from "./placement.js";
import type { ConstructionPieceDef, ConstructionPlacementConfig } from "./types.js";

const placementConfig: ConstructionPlacementConfig = {
  maxRayDistanceM: 100,
  terrainStepM: 1,
  overlapPaddingM: 0.04,
  storageKey: "test.construction",
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

describe("validateConstructionPlacement", () => {
  it("rejects placements whose footprint crosses the world edge", () => {
    const result = validateConstructionPlacement({
      piece: floor,
      position: [0.5, 0.1, 5],
      rotationQuarterTurns: 0,
      snapped: false,
      snap: null,
      terrainHit: { point: [0.5, 0, 5], distanceM: 1 },
      placedPieces: [],
      piecesById: new Map([[floor.id, floor]]),
      worldCells: 10,
      config: placementConfig,
    });

    expect(result).toEqual({ valid: false, reason: "outside world" });
  });

  it("allows grounded placements when the full footprint stays inside the world", () => {
    const result = validateConstructionPlacement({
      piece: floor,
      position: [1, 0.1, 1],
      rotationQuarterTurns: 0,
      snapped: false,
      snap: null,
      terrainHit: { point: [1, 0, 1], distanceM: 1 },
      placedPieces: [],
      piecesById: new Map([[floor.id, floor]]),
      worldCells: 10,
      config: placementConfig,
    });

    expect(result).toEqual({ valid: true, reason: null });
  });
});
