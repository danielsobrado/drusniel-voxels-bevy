import { describe, expect, it } from "vitest";
import { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionPieceDef, ConstructionSnapConfig } from "./types.js";

const config: ConstructionSnapConfig = {
  radiusM: 1.0,
  spatialCellM: 1.0,
  minAlignment: 0.7,
  alignmentWeight: 0.65,
  distanceWeight: 0.35,
};

const floor: ConstructionPieceDef = {
  id: "floor",
  label: "Floor",
  category: "floor",
  dimensionsM: [2, 0.2, 2],
  canGround: true,
  material: "wood",
  snapPoints: [
    { id: "east", localPos: [1, 0.1, 0], direction: [1, 0, 0], group: "floor-edge", accepts: ["floor-edge", "wall-bottom"] },
  ],
};

const wall: ConstructionPieceDef = {
  id: "wall",
  label: "Wall",
  category: "wall",
  dimensionsM: [2, 2, 0.2],
  canGround: false,
  material: "wood",
  snapPoints: [
    { id: "bottom", localPos: [0, -1, 0], direction: [0, -1, 0], group: "wall-bottom", accepts: ["floor-edge"] },
  ],
};

describe("ConstructionSnapIndex", () => {
  it("finds a compatible snapped wall placement", () => {
    const index = new ConstructionSnapIndex(1);
    index.addPiece(floor, "floor-1", [10, 5, 10], 0);

    const snap = index.findBestSnap([11, 5, 10], wall, 0, config);

    expect(snap).not.toBeNull();
    expect(snap?.target.entityId).toBe("floor-1");
    expect(snap?.worldPosition).toEqual([11, 6.1, 10]);
  });

  it("rejects incompatible snap groups", () => {
    const index = new ConstructionSnapIndex(1);
    index.insert({
      entityId: "roof-1",
      pieceTypeId: "roof",
      snapIndex: 0,
      worldPos: [0, 0, 0],
      worldDirection: [0, 1, 0],
      group: "roof-edge",
      accepts: ["roof-edge"],
    });

    expect(index.findBestSnap([0, 0, 0], wall, 0, config)).toBeNull();
  });
});
