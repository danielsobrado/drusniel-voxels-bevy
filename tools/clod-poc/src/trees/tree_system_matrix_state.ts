import * as THREE from "three";

export const TREE_INSTANCE_MATRIX_EPSILON = 1e-5;

export function treeMatricesNearlyEqual(
  a: THREE.Matrix4,
  b: THREE.Matrix4,
  epsilon = TREE_INSTANCE_MATRIX_EPSILON,
): boolean {
  const ae = a.elements;
  const be = b.elements;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(ae[i] - be[i]) > epsilon) return false;
  }
  return true;
}

export function setTreeInstanceMatrixWhenChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  matrix: THREE.Matrix4,
  scratch = new THREE.Matrix4(),
): boolean {
  mesh.getMatrixAt(index, scratch);
  if (treeMatricesNearlyEqual(scratch, matrix)) return false;
  mesh.setMatrixAt(index, matrix);
  return true;
}
