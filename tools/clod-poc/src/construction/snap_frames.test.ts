import { describe, expect, it } from "vitest";
import { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionPieceDef, ConstructionSnapConfig } from "./types.js";

const config: ConstructionSnapConfig = {
  radiusM: 1,
  spatialCellM: 1,
  minAlignment: 0.7,
  alignmentWeight: 0.65,
  tangentWeight: 0.25,
  distanceWeight: 0.35,
};

const restricted: ConstructionPieceDef = {
  id: "restricted",
  label: "Restricted",
  category: "generic",
  dimensionsM: [1, 1, 1],
  canGround: false,
  material: "wood",
  snapPoints: [{
    id: "socket",
    localPos: [0, 0, 0],
    direction: [0, -1, 0],
    tangent: [1, 0, 0],
    allowedTwistDegrees: [0, 180],
    group: "generic",
    accepts: ["generic"],
  }],
};

describe("construction snap frames", () => {
  it("honours source twist restrictions while scoring frame tangents", () => {
    const index = new ConstructionSnapIndex(1);
    index.insert({
      entityId: "target",
      pieceTypeId: "base",
      snapIndex: 0,
      worldPos: [0, 0, 4],
      worldDirection: [0, 1, 0],
      worldTangent: [1, 0, 0],
      group: "generic",
      accepts: ["generic"],
    });

    const candidates = index.findSnapCandidatesNearRay(
      [0, 0, 0],
      [0, 0, 1],
      8,
      restricted,
      [0, 1, 2, 3],
      config,
      1,
      0,
    );

    expect(candidates.map((candidate) => candidate.rotationQuarterTurns)).toEqual([0, 2]);
  });
});
