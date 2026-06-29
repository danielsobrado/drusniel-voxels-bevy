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
    expect(layout.indexCountsOffset).toBe(32);
    expect(layout.settingsOffset).toBe(44);
    expect(layout.materialDensityOffset).toBe(48);
    expect(layout.speciesMaterialOffset).toBe(52);
    expect(layout.visiblePlanesOffset).toBe(64);
    expect(layout.shadowPlanesOffset).toBe(88);
    expect(layout.paramBytes).toBe(16 * 46);
  });

  it("moves material and plane slots after 24 group counts for 6 species", () => {
    const layout = treeRingSpeciesLayout(6, 4);

    expect(layout.groupCount).toBe(6 * TREE_RING_LOD_COUNT);
    expect(layout.shadowGroupCount).toBe(6 * TREE_RING_LOD_COUNT * 4);
    expect(layout.indexCountsOffset).toBe(32);
    expect(layout.settingsOffset).toBe(56);
    expect(layout.materialDensityOffset).toBe(60);
    expect(layout.speciesMaterialOffset).toBe(64);
    expect(layout.visiblePlanesOffset).toBe(88);
    expect(layout.shadowPlanesOffset).toBe(112);
    expect(layout.paramBytes).toBe(16 * 52);
  });

  it("indexes groups by species then lod", () => {
    expect(treeRingSpeciesGroupIndex(0, 0, 6)).toBe(0);
    expect(treeRingSpeciesGroupIndex(0, 3, 6)).toBe(3);
    expect(treeRingSpeciesGroupIndex(1, 0, 6)).toBe(4);
    expect(treeRingSpeciesGroupIndex(5, 3, 6)).toBe(23);
  });
});
