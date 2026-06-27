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
    { id: "left", localPos: [-1, 0, 0], direction: [-1, 0, 0], group: "wall-side", accepts: ["wall-side"] },
    { id: "right", localPos: [1, 0, 0], direction: [1, 0, 0], group: "wall-side", accepts: ["wall-side"] },
  ],
};

describe("ConstructionSnapIndex", () => {
  it("finds a compatible snapped wall placement when the wall face matches the floor edge", () => {
    const index = new ConstructionSnapIndex(1);
    index.addPiece(floor, "floor-1", [10, 5, 10], 0);

    const snap = index.findBestSnap([11, 5, 10], wall, 1, config);

    expect(snap).not.toBeNull();
    expect(snap?.target.entityId).toBe("floor-1");
    expect(snap?.rotationQuarterTurns).toBe(1);
    expect(snap?.worldPosition).toEqual([11, 6.1, 10]);
  });

  it("rejects wall-bottom to floor-edge snaps when the wall face is parallel to the floor edge", () => {
    const index = new ConstructionSnapIndex(1);
    index.addPiece(floor, "floor-1", [10, 5, 10], 0);

    expect(index.findBestSnap([11, 5, 10], wall, 0, config)).toBeNull();
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

  it("finds elevated snap points near the aim ray", () => {
    const index = new ConstructionSnapIndex(1);
    index.addPiece(wall, "wall-1", [11, 6.1, 10], 0);

    const snap = index.findBestSnapNearRay(
      [10, 6.1, 8],
      [0, 0, 1],
      10,
      wall,
      0,
      config,
    );

    expect(snap).not.toBeNull();
    expect(snap?.target.entityId).toBe("wall-1");
    expect(snap?.worldPosition).toEqual([9, 6.1, 10]);
  });

  it("prefers structural wall-bottom to floor-edge snaps over nearer side snaps", () => {
    const index = new ConstructionSnapIndex(1);
    index.insert({
      entityId: "wall-near",
      pieceTypeId: "wall",
      snapIndex: 0,
      worldPos: [10.05, 6.1, 10],
      worldDirection: [1, 0, 0],
      group: "wall-side",
      accepts: ["wall-side"],
    });
    index.insert({
      entityId: "floor-far",
      pieceTypeId: "floor",
      snapIndex: 0,
      worldPos: [10.55, 5, 10],
      worldDirection: [1, 0, 0],
      group: "floor-edge",
      accepts: ["wall-bottom"],
    });

    const snap = index.findBestSnap([10, 6.1, 10], wall, 1, config);

    expect(snap).not.toBeNull();
    expect(snap?.target.entityId).toBe("floor-far");
    expect(snap?.sourceSnapIndex).toBe(0);
  });

  it("does not snap to elevated points outside the aim ray radius", () => {
    const index = new ConstructionSnapIndex(1);
    index.addPiece(wall, "wall-1", [11, 6.1, 10], 0);

    const snap = index.findBestSnapNearRay(
      [10, 4.5, 8],
      [0, 0, 1],
      10,
      wall,
      0,
      config,
    );

    expect(snap).toBeNull();
  });
});
