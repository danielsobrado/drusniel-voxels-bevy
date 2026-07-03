import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  indirectDrawGeometryStats,
  isRenderableIndirectDrawGeometry,
  renderableIndirectDrawCountForGeometry,
} from "./indirect_draw_geometry.js";

describe("indirect draw geometry guards", () => {
  it("accepts indexed geometry with positions", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    geometry.setIndex([0, 1, 2]);

    expect(indirectDrawGeometryStats(geometry)).toEqual({ vertexCount: 3, indexCount: 3, drawCount: 3 });
    expect(isRenderableIndirectDrawGeometry(geometry)).toBe(true);
    expect(renderableIndirectDrawCountForGeometry(geometry)).toBe(3);
  });

  it("rejects indexed geometry with zero indices", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    geometry.setIndex([]);

    expect(indirectDrawGeometryStats(geometry)).toEqual({ vertexCount: 3, indexCount: 0, drawCount: 0 });
    expect(isRenderableIndirectDrawGeometry(geometry)).toBe(false);
    expect(renderableIndirectDrawCountForGeometry(geometry)).toBe(0);
  });

  it("rejects geometry without positions", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex([0, 1, 2]);

    expect(isRenderableIndirectDrawGeometry(geometry)).toBe(false);
    expect(renderableIndirectDrawCountForGeometry(geometry)).toBe(0);
  });
});
