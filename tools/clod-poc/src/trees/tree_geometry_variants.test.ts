import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TREE_LODS, TREE_SPECIES } from "./tree_config.js";
import { DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import { createTreeGeometryMap, disposeTreeGeometryMap, treeGeometryVariant } from "./tree_geometry.js";
import { treeHeroGeometryStats } from "./tree_hero_fidelity.js";
import { TREE_STRUCTURAL_VARIANTS } from "./tree_instances.js";
import { treeSpeciesAtlasIndex } from "./tree_alpha_mask.js";

const HERO_LEAFY_MIN_TRIANGLES_PER_VARIANT = 512;
const TREE_STATIC_VERTEX_BUFFER_BUDGET = 5;

describe("tree variant geometry map", () => {
  it("builds selector geometries plus all configured structural variants", () => {
    const map = createTreeGeometryMap(DEFAULT_TREE_SETTINGS);
    try {
      for (const species of TREE_SPECIES) {
        expect(Object.keys(map[species].variants)).toHaveLength(TREE_STRUCTURAL_VARIANTS);
        for (const lod of TREE_LODS) {
          const selector = map[species][lod];
          const positionCount = selector.getAttribute("position")?.count;
          const packedWind = selector.getAttribute("treeWind");
          expect(selector).not.toBe(map[species].variants[0][lod]);
          expect(selector.getAttribute("treeVariant")?.count).toBe(positionCount);
          expect(selector.getAttribute("treeFoliageCard")?.count).toBe(positionCount);
          expect(packedWind?.count).toBe(positionCount);
          expect(packedWind?.itemSize).toBe(3);
          expect(packedWind?.getZ(0)).toBe(treeSpeciesAtlasIndex(species));
          expect(selector.getAttribute("treeSpeciesIndex")).toBeUndefined();
          expect(uniqueVertexBufferCount(selector)).toBeLessThanOrEqual(TREE_STATIC_VERTEX_BUFFER_BUDGET);
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
          const geometry = treeGeometryVariant(map, species, variant, "near");
          const stats = treeHeroGeometryStats(geometry);
          expect(stats.triangleCount).toBeGreaterThan(0);
          if (species !== "dead") {
            expect(stats.triangleCount).toBeGreaterThanOrEqual(HERO_LEAFY_MIN_TRIANGLES_PER_VARIANT);
            expect(stats.foliageTriangleCount).toBeGreaterThan(0);
            expect(stats.hasRealFoliage).toBe(true);
            expect(geometry.getAttribute("treeFoliageCard")).toBeTruthy();
          }
        }
      }
    } finally {
      disposeTreeGeometryMap(map);
    }
  }, 30000);
});

function uniqueVertexBufferCount(geometry: THREE.BufferGeometry): number {
  const buffers = new Set<unknown>();
  for (const attribute of Object.values(geometry.attributes)) {
    buffers.add(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data : attribute);
  }
  return buffers.size;
}
