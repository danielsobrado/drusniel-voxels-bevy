import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  treeImpostorUvRectAttribute,
  treeLodFadeAttribute,
  treeWorldXZAttribute,
  updateTreeMeshAfterLod,
  updateTreeMeshBounds,
} from "./index.js";

describe("tree system mesh bounds updater", () => {
  it("hides zero-count meshes and returns empty bounds state", () => {
    const mesh = testMesh();
    mesh.count = 1;
    const state = updateTreeMeshAfterLod({
      mesh,
      nextCount: 0,
      center: new THREE.Vector3(10, 0, 20),
      lod: "near",
      matrixChanged: false,
      worldXZChanged: false,
      impostorUvChanged: false,
      fadeChanged: false,
      axialBillboard: false,
    });

    expect(mesh.visible).toBe(false);
    expect(state).toEqual({ count: 0, centerX: 10, centerZ: 20, hasBounds: false });
  });

  it("marks dirty instance attributes and refreshes bounds", () => {
    const mesh = testMesh();
    const computeSphere = vi.spyOn(mesh, "computeBoundingSphere");
    const computeBox = vi.spyOn(mesh, "computeBoundingBox");
    const state = updateTreeMeshAfterLod({
      mesh,
      nextCount: 1,
      center: new THREE.Vector3(1, 0, 2),
      lod: "near",
      matrixChanged: true,
      worldXZChanged: true,
      impostorUvChanged: true,
      fadeChanged: true,
      axialBillboard: false,
    });

    expect(mesh.visible).toBe(true);
    expect(mesh.instanceMatrix.needsUpdate).toBe(true);
    expect(treeWorldXZAttribute(mesh).needsUpdate).toBe(true);
    expect(treeLodFadeAttribute(mesh).needsUpdate).toBe(true);
    expect(treeImpostorUvRectAttribute(mesh).needsUpdate).toBe(true);
    expect(computeSphere).toHaveBeenCalledTimes(1);
    expect(computeBox).toHaveBeenCalledTimes(1);
    expect(state.hasBounds).toBe(true);
  });

  it("reuses bounds state when nothing moved", () => {
    const mesh = testMesh();
    mesh.count = 1;
    const previousState = { count: 1, centerX: 0, centerZ: 0, hasBounds: true };
    const computeSphere = vi.spyOn(mesh, "computeBoundingSphere");
    const state = updateTreeMeshAfterLod({
      mesh,
      nextCount: 1,
      center: new THREE.Vector3(0.1, 0, 0.1),
      lod: "near",
      matrixChanged: false,
      worldXZChanged: false,
      impostorUvChanged: false,
      fadeChanged: false,
      axialBillboard: false,
      previousState,
      boundsRefreshDistanceM: 1,
    });

    expect(state).toBe(previousState);
    expect(computeSphere).not.toHaveBeenCalled();
  });

  it("inflates billboard bounds", () => {
    const mesh = testMesh();
    updateTreeMeshBounds(mesh, false);
    const normalRadius = mesh.boundingSphere?.radius ?? 0;
    updateTreeMeshBounds(mesh, true);
    expect(mesh.boundingSphere?.radius).toBeGreaterThan(normalRadius);
    expect(mesh.boundingBox?.min.x).toBeLessThan(-0.5);
  });
});

function testMesh(): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1) as THREE.BufferGeometry;
  geometry.setAttribute("treeWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(2), 2));
  geometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
  geometry.setAttribute("treeImpostorUvRect", new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
  return new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 1);
}
