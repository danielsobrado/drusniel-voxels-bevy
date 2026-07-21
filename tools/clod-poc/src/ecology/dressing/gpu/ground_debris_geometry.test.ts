import { describe, expect, it } from "vitest";
import { createGroundDebrisGeometry } from "./ground_debris_geometry.js";

const FLAT_CLASSES = [
  "leaf_litter",
  "needle_litter",
  "twig_cluster",
  "bark_chip_cluster",
] as const;

const STONE_CLASSES = [
  "small_talus",
  "river_cobbles",
  "wet_stone_cluster",
] as const;

describe("ground debris geometry", () => {
  it("provides indexed geometry for every owned class and LOD", () => {
    for (const classId of [...FLAT_CLASSES, ...STONE_CLASSES]) {
      for (let lod = 0; lod < 3; lod += 1) {
        const geometry = createGroundDebrisGeometry(classId, lod);
        expect(geometry).not.toBeNull();
        expect(geometry!.getAttribute("position").count).toBeGreaterThan(0);
        expect(geometry!.getIndex()?.count ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("keeps litter and wood fragments ground-aligned at the far LOD", () => {
    for (const classId of FLAT_CLASSES) {
      const geometry = createGroundDebrisGeometry(classId, 2)!;
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      const width = bounds.max.x - bounds.min.x;
      const depth = bounds.max.z - bounds.min.z;
      const height = bounds.max.y - bounds.min.y;
      expect(height).toBeLessThanOrEqual(0.04);
      expect(Math.max(width, depth)).toBeGreaterThan(height * 5);
    }
  });

  it("keeps pebble families seated above their local origin", () => {
    for (const classId of STONE_CLASSES) {
      for (let lod = 0; lod < 3; lod += 1) {
        const geometry = createGroundDebrisGeometry(classId, lod)!;
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox!;
        expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-6);
        expect(bounds.max.y).toBeLessThan(1);
        expect(bounds.max.x - bounds.min.x).toBeGreaterThan(bounds.max.y - bounds.min.y);
      }
    }
  });

  it("does not override non-debris geometry families", () => {
    expect(createGroundDebrisGeometry("dead_log_fresh", 0)).toBeNull();
    expect(createGroundDebrisGeometry("bank_fern", 1)).toBeNull();
  });
});
