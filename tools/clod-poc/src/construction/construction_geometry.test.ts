import { describe, expect, it } from "vitest";
import { createPieceGeometry } from "./construction_controller_support.js";
import type { ConstructionPieceDef } from "./types.js";

const compoundPiece: ConstructionPieceDef = {
  id: "compound",
  label: "Compound",
  category: "opening",
  dimensionsM: [2, 2, 0.2],
  canGround: false,
  material: "wood",
  snapPoints: [],
  geometryParts: [
    { kind: "box", center: [-0.8, 0, 0], dimensionsM: [0.4, 2, 0.2], rotationDegrees: [0, 0, 0] },
    { kind: "box", center: [0.8, 0, 0], dimensionsM: [0.4, 2, 0.2], rotationDegrees: [0, 0, 0] },
    { kind: "box", center: [0, 0.8, 0], dimensionsM: [1.2, 0.4, 0.2], rotationDegrees: [0, 0, 0] },
  ],
  placementBoxes: [
    { center: [-0.8, 0, 0], dimensionsM: [0.4, 2, 0.2] },
    { center: [0.8, 0, 0], dimensionsM: [0.4, 2, 0.2] },
    { center: [0, 0.8, 0], dimensionsM: [1.2, 0.4, 0.2] },
  ],
};

describe("construction compound render geometry", () => {
  it("merges configured geometry parts and preserves the declared outer bounds", () => {
    const geometry = createPieceGeometry(compoundPiece);
    const bounds = geometry.boundingBox;
    expect(bounds).not.toBeNull();
    expect(bounds!.min.x).toBeCloseTo(-1);
    expect(bounds!.max.x).toBeCloseTo(1);
    expect(bounds!.min.y).toBeCloseTo(-1);
    expect(bounds!.max.y).toBeCloseTo(1);
    expect(geometry.getAttribute("uv2")).toBeDefined();
    expect(geometry.getAttribute("position").count).toBeGreaterThan(24);
    geometry.dispose();
  });

  it("supports true three-axis part rotation for diagonal beams", () => {
    const geometry = createPieceGeometry({
      ...compoundPiece,
      id: "diagonal",
      dimensionsM: [2, 2, 0.2],
      geometryParts: [{
        kind: "box",
        center: [0, 0, 0],
        dimensionsM: [2.83, 0.2, 0.2],
        rotationDegrees: [0, 0, 45],
      }],
    });
    expect(geometry.boundingBox!.max.x).toBeGreaterThan(0.95);
    expect(geometry.boundingBox!.max.y).toBeGreaterThan(0.95);
    expect(geometry.boundingBox!.min.x).toBeLessThan(-0.95);
    expect(geometry.boundingBox!.min.y).toBeLessThan(-0.95);
    geometry.dispose();
  });
});
