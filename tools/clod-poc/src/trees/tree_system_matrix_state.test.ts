import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { setTreeInstanceMatrixWhenChanged, treeMatricesNearlyEqual } from "./tree_system_matrix_state.js";

describe("tree instance matrix state helpers", () => {
  it("compares matrices with epsilon", () => {
    const a = new THREE.Matrix4().makeTranslation(1, 2, 3);
    const b = a.clone();
    b.elements[12] += 1e-6;
    expect(treeMatricesNearlyEqual(a, b)).toBe(true);
    b.elements[12] += 1e-3;
    expect(treeMatricesNearlyEqual(a, b)).toBe(false);
  });

  it("sets matrix only when changed", () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    const unchanged = new THREE.Matrix4();
    const changed = new THREE.Matrix4().makeTranslation(1, 2, 3);

    expect(setTreeInstanceMatrixWhenChanged(mesh, 0, unchanged)).toBe(false);
    expect(setTreeInstanceMatrixWhenChanged(mesh, 0, changed)).toBe(true);
    expect(setTreeInstanceMatrixWhenChanged(mesh, 0, changed)).toBe(false);

    const current = new THREE.Matrix4();
    mesh.getMatrixAt(0, current);
    expect(treeMatricesNearlyEqual(current, changed)).toBe(true);
  });
});
