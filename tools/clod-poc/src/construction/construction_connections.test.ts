import { describe, expect, it } from "vitest";
import { findConstructionConnectionIds } from "./construction_connections.js";
import type { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionPieceDef, IndexedConstructionSnapPoint } from "./types.js";

const piece: ConstructionPieceDef = {
  id: "bridge",
  label: "Bridge",
  category: "floor",
  dimensionsM: [4, 0.2, 2],
  canGround: false,
  material: "wood",
  snapPoints: [
    { id: "left", localPos: [-2, 0, 0], direction: [-1, 0, 0], group: "floor-edge", accepts: ["floor-edge"] },
    { id: "right", localPos: [2, 0, 0], direction: [1, 0, 0], group: "floor-edge", accepts: ["floor-edge"] },
  ],
};

function target(entityId: string, x: number): IndexedConstructionSnapPoint {
  return {
    entityId,
    pieceTypeId: "support",
    snapIndex: 0,
    worldPos: [x, 0, 0],
    worldDirection: [x < 0 ? 1 : -1, 0, 0],
    group: "floor-edge",
    accepts: ["floor-edge"],
  };
}

describe("findConstructionConnectionIds", () => {
  it("records every coincident compatible support, not only the selected target", () => {
    const fakeIndex = {
      queryRadius(center: readonly [number, number, number]) {
        return center[0] < 0 ? [target("left-support", -2)] : [target("right-support", 2)];
      },
    } as unknown as ConstructionSnapIndex;

    expect(findConstructionConnectionIds({
      piece,
      position: [0, 0, 0],
      rotationQuarterTurns: 0,
      snapIndex: fakeIndex,
      existingPieceIds: new Set(["left-support", "right-support"]),
      toleranceM: 0.08,
    })).toEqual(["left-support", "right-support"]);
  });
});
