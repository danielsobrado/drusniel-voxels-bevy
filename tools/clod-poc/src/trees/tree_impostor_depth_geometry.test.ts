import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTreeImpostorDepthGridGeometry } from "./tree_impostor_depth_geometry.js";

function quad(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, 0, 0,
    1, 0, 0,
    1, 2, 0,
    -1, 2, 0,
  ], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ], 2));
  geometry.setAttribute("custom", new THREE.Float32BufferAttribute([0, 1, 3, 2], 1));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.userData.depthCard = true;
  return geometry;
}

describe("tree impostor depth geometry", () => {
  it("turns the four-corner card into a bounded 3x3-cell grid", () => {
    const result = createTreeImpostorDepthGridGeometry(quad());

    expect(result.getAttribute("position").count).toBe(16);
    expect(result.getIndex()?.count).toBe(54);
    expect(result.userData.depthCard).toBe(true);
    expect(result.boundingBox).not.toBeNull();
    expect(result.boundingSphere).not.toBeNull();
  });

  it("bilinearly preserves geometry and custom attributes", () => {
    const result = createTreeImpostorDepthGridGeometry(quad());
    const position = result.getAttribute("position");
    const custom = result.getAttribute("custom");

    expect(position.getX(0)).toBe(-1);
    expect(position.getY(0)).toBe(0);
    expect(position.getX(15)).toBe(1);
    expect(position.getY(15)).toBe(2);
    expect(position.getX(5)).toBeCloseTo(-1 / 3, 6);
    expect(position.getY(5)).toBeCloseTo(2 / 3, 6);
    expect(custom.getX(5)).toBeCloseTo(1, 6);
  });

  it("returns unsupported geometry unchanged", () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    source.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0], 2));

    expect(createTreeImpostorDepthGridGeometry(source)).toBe(source);
    expect(createTreeImpostorDepthGridGeometry(quad(), 1).getAttribute("position").count).toBe(4);
  });
});
