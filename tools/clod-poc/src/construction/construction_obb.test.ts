import { describe, expect, it } from "vitest";
import { constructionBoundsFor, constructionBoundsOverlap } from "./construction_bounds.js";
import { constructionPiecesOverlap } from "./construction_obb.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

const diagonalBeam: ConstructionPieceDef = {
  id: "diagonal-beam",
  label: "Diagonal Beam",
  category: "generic",
  dimensionsM: [4, 0.2, 0.4],
  canGround: true,
  material: "wood",
  snapPoints: [],
  placementBoxes: [{ center: [0, 0, 0], dimensionsM: [4, 0.2, 0.4], rotationYDegrees: 45 }],
};

function placed(z: number): PlacedConstructionPiece {
  return { id: `beam-${z}`, typeId: diagonalBeam.id, position: [0, 0, z], rotationQuarterTurns: 0, grounded: true };
}

describe("construction OBB validation", () => {
  it("rejects AABB false positives for separated diagonal pieces", () => {
    const a = constructionBoundsFor(diagonalBeam, [0, 0, 0], 0);
    const b = constructionBoundsFor(diagonalBeam, [0, 0, 1], 0);
    expect(constructionBoundsOverlap(a, b)).toBe(true);
    expect(constructionPiecesOverlap({
      piece: diagonalBeam,
      position: [0, 0, 0],
      rotationQuarterTurns: 0,
      otherPiece: diagonalBeam,
      other: placed(1),
      insetM: 0,
    })).toBe(false);
  });

  it("detects actual diagonal proxy intersections", () => {
    expect(constructionPiecesOverlap({
      piece: diagonalBeam,
      position: [0, 0, 0],
      rotationQuarterTurns: 0,
      otherPiece: diagonalBeam,
      other: placed(0.2),
      insetM: 0,
    })).toBe(true);
  });
});
