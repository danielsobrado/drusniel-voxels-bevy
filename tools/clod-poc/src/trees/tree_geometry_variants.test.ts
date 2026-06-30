import { describe, expect, it } from "vitest";
import { TREE_LODS, TREE_SPECIES } from "./tree_config.js";
import { DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import { createTreeGeometryMap, disposeTreeGeometryMap, treeGeometryVariant } from "./tree_geometry.js";
import { treeHeroGeometryStats } from "./tree_hero_fidelity.js";
import { TREE_STRUCTURAL_VARIANTS } from "./tree_instances.js";

const HERO_LEAFY_MIN_TRIANGLES_PER_VARIANT = 512;

describe("tree variant geometry map", () => {
  it("builds selector geometries plus all configured structural variants", () => {
    const map = createTreeGeometryMap(DEFAULT_TREE_SETTINGS);
    try {
      for (const species of TREE_SPECIES) {
        expect(Object.keys(map[species].variants)).toHaveLength(TREE_STRUCTURAL_VARIANTS);
        for (const lod of TREE_LODS) {
          expect(map[species][lod]).not.toBe(map[species].variants[0][lod]);
          expect(map[species][lod].getAttribute("treeVariant")?.count).toBe(
            map[species][lod].getAttribute("position")?.count,
          );
          expect(treeGeometryVariant(map, species, 0, lod)).toBe(map[species].variants[0][lod]);
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

  it("keeps leafy near variants above the static geometry floor", () => {
    const map = createTreeGeometryMap(DEFAULT_TREE_SETTINGS);
    try {
      for (const species of TREE_SPECIES) {
        for (let variant = 0; variant < TREE_STRUCTURAL_VARIANTS; variant++) {
          const stats = treeHeroGeometryStats(treeGeometryVariant(map, species, variant, "near"));
          expect(stats.triangleCount).toBeGreaterThan(0);
          if (species !== "dead") {
            expect(stats.triangleCount).toBeGreaterThanOrEqual(HERO_LEAFY_MIN_TRIANGLES_PER_VARIANT);
            expect(stats.foliageTriangleCount).toBeGreaterThan(0);
            expect(stats.hasRealFoliage).toBe(true);
          }
        }
      }
    } finally {
      disposeTreeGeometryMap(map);
    }
  }, 30000);
});
