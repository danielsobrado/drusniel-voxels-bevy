import * as THREE from "three";

export interface ConstructionAimRayInput {
  raycaster: THREE.Raycaster;
  camera: THREE.PerspectiveCamera;
  pointerNdc: THREE.Vector2;
  centerNdc: THREE.Vector2;
  pointerInside: boolean;
  rendererDomElement: HTMLElement;
}

export function readConstructionAimRay(input: ConstructionAimRayInput): THREE.Ray | null {
  if (document.pointerLockElement === input.rendererDomElement) {
    input.raycaster.setFromCamera(input.centerNdc, input.camera);
    return input.raycaster.ray.clone();
  }
  if (!input.pointerInside) return null;
  input.raycaster.setFromCamera(input.pointerNdc, input.camera);
  return input.raycaster.ray.clone();
}

export interface ConstructionAimedPieceInput {
  ray: THREE.Ray;
  raycaster: THREE.Raycaster;
  camera: THREE.Camera;
  root: THREE.Object3D;
  meshes: readonly THREE.Mesh[];
}

export function aimedConstructionPieceIndex(input: ConstructionAimedPieceInput): number {
  input.camera.updateMatrixWorld(true);
  input.root.updateMatrixWorld(true);
  input.raycaster.ray.copy(input.ray);
  const hit = input.raycaster.intersectObjects([...input.meshes], false)[0];
  return hit ? input.meshes.indexOf(hit.object as THREE.Mesh) : -1;
}
