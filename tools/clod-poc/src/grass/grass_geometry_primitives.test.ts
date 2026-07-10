import { describe, expect, it } from "vitest";
import { createBladeGeometry, createGrassTuftGeometry } from "./grass_geometry_primitives.js";

describe("grass geometry primitives", () => {
  it("uses opposing rounded edge normals on a blade strip", () => {
    const geometry = createBladeGeometry();
    try {
      const normals = geometry.getAttribute("normal");
      const positions = geometry.getAttribute("position");

      expect(normals.count).toBe(positions.count);
      expect(normals.getX(0)).toBeLessThan(-0.5);
      expect(normals.getX(1)).toBeGreaterThan(0.5);
      expect(normals.getY(0)).toBeGreaterThan(0);
      expect(normals.getZ(0)).toBeLessThan(-0.5);
      expect(normals.getZ(1)).toBeLessThan(-0.5);
    } finally {
      geometry.dispose();
    }
  });

  it("keeps rounded normals on crossed far tufts", () => {
    const geometry = createGrassTuftGeometry();
    try {
      const normals = geometry.getAttribute("normal");
      expect(normals.count).toBeGreaterThan(0);
      expect(Math.abs(normals.getX(0)) + Math.abs(normals.getZ(0))).toBeGreaterThan(0.8);
      expect(normals.getY(0)).toBeGreaterThan(0);
    } finally {
      geometry.dispose();
    }
  });
});
