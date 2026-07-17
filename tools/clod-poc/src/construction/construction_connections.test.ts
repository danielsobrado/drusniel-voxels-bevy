import { describe, expect, it } from "vitest";
import { findConstructionConnectionIds } from "./construction_connections.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionPieceDef } from "./types.js";

const anchor: ConstructionPieceDef = {
  id: "anchor",
  label: "Anchor",
  category: "generic",
  dimensionsM: [1, 1, 1],
  canGround: true,
  material: "wood",
  snapPoints: [{
    id: "socket",
    localPos: [0, 0, 0],
    direction: [1, 0, 0],
    tangent: [0, 1, 0],
    group: "generic",
    accepts: ["generic"],
  }],
};
const bridge: ConstructionPieceDef = {
  id: "bridge",
  label: "Bridge",
  category: "floor",
  dimensionsM: [2, 0.2, 1],
  canGround: false,
  material: "wood",
  snapPoints: [
    {
      id: "left",
      localPos: [-1, 0, 0],
      direction: [-1, 0, 0],
      tangent: [0, 1, 0],
      group: "generic",
      accepts: ["generic"],
    },
    {
      id: "right",
      localPos: [1, 0, 0],
      direction: [1, 0, 0],
      tangent: [0, 1, 0],
      group: "generic",
      accepts: ["generic"],
    },
  ],
};

describe("construction connection detection", () => {
  it("records every compatible, opposing socket contact", () => {
    const index = new ConstructionSnapIndex(1);
    index.addPiece(anchor, "left-support", [-1, 0, 0], 0);
    index.addPiece(anchor, "right-support", [1, 0, 0], 2);
    const connectionIds = findConstructionConnectionIds({
      snapIndex: index,
      piece: bridge,
      position: [0, 0, 0],
      rotationQuarterTurns: 0,
      toleranceM: 0.08,
      requiredTargetId: "left-support",
    });
    expect(connectionIds).toEqual(["left-support", "right-support"]);
  });

  it("deduplicates multiple contacts with the same entity", () => {
    const index = new ConstructionSnapIndex(1);
    index.addPiece({
      ...anchor,
      snapPoints: [
        { ...anchor.snapPoints[0]!, id: "a", localPos: [-1, 0, 0] },
        { ...anchor.snapPoints[0]!, id: "b", localPos: [1, 0, 0] },
      ],
    }, "compound-support", [0, 0, 0], 0);
    expect(findConstructionConnectionIds({
      snapIndex: index,
      piece: bridge,
      position: [0, 0, 0],
      rotationQuarterTurns: 0,
      toleranceM: 0.08,
    })).toEqual(["compound-support"]);
  });

  it("rejects coincident sockets that face the same direction", () => {
    const index = new ConstructionSnapIndex(1);
    index.addPiece(anchor, "wrong-way-support", [-1, 0, 0], 2);

    expect(findConstructionConnectionIds({
      snapIndex: index,
      piece: { ...bridge, snapPoints: [bridge.snapPoints[0]!] },
      position: [0, 0, 0],
      rotationQuarterTurns: 0,
      toleranceM: 0.08,
    })).toEqual([]);
  });
});
