import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  bufferGeometryToPropMesh,
  initPropSimplifier,
  propMeshToBufferGeometry,
  propTriangleCount,
  simplifyPropMesh,
  type PropMeshData,
} from "./prop_mesh_simplify.js";

function buildGridMesh(): PropMeshData {
  const n = 17;
  const positions: number[] = [];
  const normals: number[] = [];
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      positions.push(x, Math.sin(x * 0.2), z);
      normals.push(0, 1, 0);
    }
  }
  const indices: number[] = [];
  for (let z = 0; z < n - 1; z++) {
    for (let x = 0; x < n - 1; x++) {
      const a = z * n + x;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

describe("prop_mesh_simplify", () => {
  it("reduces triangle count for a relief grid mesh", async () => {
    await initPropSimplifier();
    const source = buildGridMesh();
    expect(propTriangleCount(source)).toBeGreaterThan(100);

    const simplified = simplifyPropMesh(source, 0.5, 0.05);
    expect(propTriangleCount(simplified)).toBeLessThan(propTriangleCount(source));
    expect(simplified.errorWorld).toBeGreaterThanOrEqual(0);

    const rebuilt = propMeshToBufferGeometry(simplified);
    expect(rebuilt.getAttribute("position")).toBeTruthy();
    expect(rebuilt.getAttribute("normal")).toBeTruthy();
  });

  it("round-trips buffer geometry through simplify", async () => {
    await initPropSimplifier();
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const source = bufferGeometryToPropMesh(geom);
    const simplified = simplifyPropMesh(source, 0.85, 0.5);
    expect(propTriangleCount(simplified)).toBeGreaterThan(0);
  });
});
