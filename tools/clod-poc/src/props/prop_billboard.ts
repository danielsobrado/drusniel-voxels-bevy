import * as THREE from "three";

const BILLBOARD_MATERIAL_KEY = "billboardMaterial";

/** Axial billboard quad facing +Z in local space; instance rotation handles world alignment. */
export function createPropBillboardGeometry(width: number, height: number): THREE.BufferGeometry {
  const hw = width * 0.5;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    -hw, 0, 0,
    hw, 0, 0,
    hw, height, 0,
    -hw, height, 0,
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

export function createBillboardMaterial(base: THREE.Material): THREE.Material {
  const mat = base.clone();
  if (mat instanceof THREE.MeshStandardMaterial) {
    mat.side = THREE.DoubleSide;
    mat.transparent = false;
  }
  return mat;
}

export function assignBillboardMaterial(geometry: THREE.BufferGeometry, material: THREE.Material): void {
  geometry.userData[BILLBOARD_MATERIAL_KEY] = material;
}

export function getBillboardMaterial(geometry: THREE.BufferGeometry): THREE.Material | undefined {
  const value = geometry.userData[BILLBOARD_MATERIAL_KEY];
  return value instanceof THREE.Material ? value : undefined;
}

export function disposeBillboardGeometryResources(geometry: THREE.BufferGeometry | null | undefined): void {
  getBillboardMaterial(geometry!)?.dispose();
  geometry?.dispose();
}
