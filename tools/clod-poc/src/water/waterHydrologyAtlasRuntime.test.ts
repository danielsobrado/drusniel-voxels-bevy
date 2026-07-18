import { describe, expect, it } from "vitest";
import { waterAtlasTilesPerSide } from "./waterHydrologyAtlasRuntime.js";

describe("water hydrology atlas sizing", () => {
  it("keeps the original odd window when no clipmap snap margin is required", () => {
    expect(waterAtlasTilesPerSide(768, 256)).toBe(7);
  });

  it("expands the window when the snapped ring can extend past camera-centred coverage", () => {
    // L3: 12 m cells, 128 cells per side, snap_cells=2.
    // The ring half-span is 768 m and its snapped center can lag by almost 24 m.
    expect(waterAtlasTilesPerSide(768, 256, 24)).toBe(9);
  });

  it("clamps invalid dimensions instead of returning an even or empty window", () => {
    expect(waterAtlasTilesPerSide(-1, 0, -1)).toBe(1);
  });
});
