import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { EqualDepth } from "three";
import { depthPrepassTwin } from "./veg_prepass.js";

describe("depthPrepassTwin", () => {
  it("clones color material by default", () => {
    const sourceMaterial = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), sourceMaterial);

    const twin = depthPrepassTwin(mesh, { positionNode: {}, side: THREE.DoubleSide });

    expect(twin.geometry).toBe(mesh.geometry);
    expect(mesh.material).not.toBe(sourceMaterial);
    expect((mesh.material as THREE.Material).depthFunc).toBe(EqualDepth);
    expect((mesh.material as THREE.Material).depthWrite).toBe(false);
    expect(sourceMaterial.depthWrite).toBe(true);
  });

  it("can keep the original color material live", () => {
    const sourceMaterial = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), sourceMaterial);

    const twin = depthPrepassTwin(
      mesh,
      { positionNode: {}, side: THREE.DoubleSide },
      { cloneColorMaterial: false },
    );

    expect(twin.geometry).toBe(mesh.geometry);
    expect(mesh.material).toBe(sourceMaterial);
    expect(sourceMaterial.depthFunc).toBe(EqualDepth);
    expect(sourceMaterial.depthWrite).toBe(false);
  });
});
