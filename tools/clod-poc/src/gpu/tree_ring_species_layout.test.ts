import { describe, expect, it } from "vitest";
import {
  TREE_RING_LOD_COUNT,
  treeRingSpeciesGroupIndex,
  treeRingSpeciesLayout,
} from "./tree_ring_species_layout.js";

describe("tree ring species layout", () => {
  it("keeps current 3-species layout compatible with the existing shader slots", () => {
    const layout = treeRingSpeciesLayout(3, 4);

    expect(layout.groupCount).toBe(3 * TREE_RING_LOD_COUNT);
    expect(layout.shadowGroupCount).toBe(3 * TREE_RING_LOD_COUNT * 4);
    expect(layout.speciesWeightsOffset).toBe(28);
    expect(layout.speciesWeightsFloatCount).toBe(4);
    expect(layout.indexCountsOffset).toBe(32);
    expect(layout.settingsOffset).toBe(44);
    expect(layout.materialDensityOffset).toBe(48);
    expect(layout.speciesMaterialOffset).toBe(52);
    expect(layout.visiblePlanesOffset).toBe(64);
    expect(layout.shadowPlanesOffset).toBe(88);
    expect(layout.paramBytes).toBe(16 * 46);
  });

  it("moves index/material/plane slots after two species-weight vec4s for 6 species", () => {
    const layout = treeRingSpeciesLayout(6, 4);

    expect(layout.groupCount).toBe(6 * TREE_RING_LOD_COUNT);
    expect(layout.shadowGroupCount).toBe(6 * TREE_RING_LOD_COUNT * 4);
    expect(layout.speciesWeightsOffset).toBe(28);
    expect(layout.speciesWeightsFloatCount).toBe(8);
    expect(layout.indexCountsOffset).toBe(36);
    expect(layout.settingsOffset).toBe(60);
    expect(layout.materialDensityOffset).toBe(64);
    expect(layout.speciesMaterialOffset).toBe(68);
    expect(layout.visiblePlanesOffset).toBe(92);
    expect(layout.shadowPlanesOffset).toBe(116);
    expect(layout.paramBytes).toBe(16 * 53);
  });

  it("indexes groups by species then lod", () => {
    expect(treeRingSpeciesGroupIndex(0, 0, 6)).toBe(0);
    expect(treeRingSpeciesGroupIndex(0, 3, 6)).toBe(3);
    expect(treeRingSpeciesGroupIndex(1, 0, 6)).toBe(4);
    expect(treeRingSpeciesGroupIndex(5, 3, 6)).toBe(23);
  });
});
