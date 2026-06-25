import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TerrainColliderSet } from "./terrain_collider.js";
import type { PageMesh } from "../types.js";

function planeMesh(x0: number, z0: number, x1: number, z1: number): PageMesh {
  return {
    positions: new Float32Array([
      x0, 0, z0,
      x1, 0, z0,
      x1, 0, z1,
      x0, 0, z1,
    ]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    paintSlots: new Float32Array([0, 0, 0, 0]),
    materialWeights: new Float32Array(16),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

describe("TerrainColliderSet lazy mesh sources", () => {
  it("builds BVHs only for ray-intersected page footprints", () => {
    const colliders = new TerrainColliderSet([
      { id: "near", mesh: planeMesh(0, 0, 10, 10), footprint: { minX: 0, minZ: 0, maxX: 10, maxZ: 10 } },
      { id: "far", mesh: planeMesh(20, 0, 30, 10), footprint: { minX: 20, minZ: 0, maxX: 30, maxZ: 10 } },
    ]);

    expect(colliders.loadedPageCount()).toBe(0);
    const hit = colliders.raycastSurface(new THREE.Ray(
      new THREE.Vector3(5, 10, 5),
      new THREE.Vector3(0, -1, 0),
    ));

    expect(hit?.pageId).toBe("near");
    expect(colliders.loadedPageCount()).toBe(1);
    colliders.dispose();
  });
});
