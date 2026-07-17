import { describe, expect, it } from "vitest";
import { parseConstructionConfig } from "./config.js";

describe("construction Phase 3 config", () => {
  it("parses compound render parts independently from placement proxies", () => {
    const config = parseConstructionConfig(`
construction:
  terrain_conform:
    foundation_categories: [floor, foundation]
  pieces:
    - id: compound
      label: Compound
      category: opening
      dimensions_m: [2, 2, 0.2]
      can_ground: false
      material: wood
      geometry_parts:
        - kind: box
          center: [0, 0, 0]
          dimensions_m: [1, 2, 0.2]
          rotation_degrees: [0, 15, 45]
      placement_boxes:
        - center: [0, 0, 0]
          dimensions_m: [2, 2, 0.2]
          rotation_y_degrees: 30
`);

    expect(config.terrainConform.foundationCategories).toEqual(["floor", "foundation"]);
    expect(config.pieces[0]?.category).toBe("opening");
    expect(config.pieces[0]?.geometryParts).toEqual([{
      kind: "box",
      center: [0, 0, 0],
      dimensionsM: [1, 2, 0.2],
      rotationDegrees: [0, 15, 45],
    }]);
    expect(config.pieces[0]?.placementBoxes).toEqual([{
      center: [0, 0, 0],
      dimensionsM: [2, 2, 0.2],
      rotationYDegrees: 30,
    }]);
  });
});
