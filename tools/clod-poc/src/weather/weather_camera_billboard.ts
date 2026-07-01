import * as THREE from "three";

export interface CameraBillboardOptions {
  camera: THREE.PerspectiveCamera;
  mesh: THREE.Object3D;
  cameraPosition: THREE.Vector3;
  distance: number;
  widthScale?: number;
  heightScale?: number;
  scratchDirection: THREE.Vector3;
}

export function placeCameraFacingBillboard(options: CameraBillboardOptions): void {
  const widthScale = options.widthScale ?? 1;
  const heightScale = options.heightScale ?? 1;
  options.camera.getWorldDirection(options.scratchDirection);
  options.mesh.position.copy(options.cameraPosition).addScaledVector(options.scratchDirection, options.distance);
  options.mesh.quaternion.copy(options.camera.quaternion);
  const height = 2 * options.distance * Math.tan(THREE.MathUtils.degToRad(options.camera.fov) * 0.5);
  options.mesh.scale.set(height * options.camera.aspect * widthScale, height * heightScale, 1);
}
