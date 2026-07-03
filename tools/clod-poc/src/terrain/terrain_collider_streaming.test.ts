import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TerrainColliderSet } from "./terrain_collider.js";

function triangleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 0, 1,
  ]), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  return geometry;
}

describe("TerrainColliderSet streamed pages", () => {
  it("adds, replaces, and removes streamed collider pages", () => {
    const colliders = new TerrainColliderSet([]);
    const footprint = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };

    expect(colliders.pageCount()).toBe(0);

    colliders.upsertPage({ id: "live:0", geometry: triangleGeometry(), footprint });
    expect(colliders.pageCount()).toBe(1);

    colliders.upsertPage({ id: "live:0", geometry: triangleGeometry(), footprint });
    expect(colliders.pageCount()).toBe(1);

    expect(colliders.removePage("live:0")).toBe(true);
    expect(colliders.pageCount()).toBe(0);
    expect(colliders.removePage("live:0")).toBe(false);
  });
});
