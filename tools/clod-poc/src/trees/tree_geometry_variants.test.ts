import { describe, expect, it } from "vitest";
import { TREE_LODS, TREE_SPECIES } from "./tree_config.js";
import { DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import { createTreeGeometryMap, disposeTreeGeometryMap, treeGeometryVariant } from "./tree_geometry.js";
import { TREE_STRUCTURAL_VARIANTS } from "./tree_instances.js";

describe("tree variant geometry map", () => {
  it("builds all configured variants while preserving variant-zero compatibility", () => {
    const map = createTreeGeometryMap(DEFAULT_TREE_SETTINGS);
    try {
      for (const species of TREE_SPECIES) {
        expect(Object.keys(map[species].variants)).toHaveLength(TREE_STRUCTURAL_VARIANTS);
        for (const lod of TREE_LODS) {
          expect(map[species][lod]).toBe(map[species].variants[0][lod]);
          expect(treeGeometryVariant(map, species, 0, lod)).toBe(map[species][lod]);
        }
      }
    } finally {
      disposeTreeGeometryMap(map);
    }
  }, 30000);

  it("clamps invalid variant requests to a valid geometry", () => {
    const map = createTreeGeometryMap(DEFAULT_TREE_SETTINGS);
    try {
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          expect(treeGeometryVariant(map, species, -100, lod)).toBe(map[species].variants[0][lod]);
          expect(treeGeometryVariant(map, species, 999, lod)).toBe(map[species].variants[TREE_STRUCTURAL_VARIANTS - 1][lod]);
        }
      }
    } finally {
      disposeTreeGeometryMap(map);
    }
  }, 30000);
});
