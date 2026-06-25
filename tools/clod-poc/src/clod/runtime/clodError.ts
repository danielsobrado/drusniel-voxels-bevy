import * as THREE from "three";
import type { ClodPageNodeRuntime } from "./clodRuntimeTypes.js";

export function computeNodeDistanceToCamera(
  node: ClodPageNodeRuntime,
  camera: THREE.PerspectiveCamera,
): number {
  const c = node.boundingSphere.center;
  const camPos = camera.position;
  const dx = camPos.x - c[0];
  const dy = camPos.y - c[1];
  const dz = camPos.z - c[2];
  const distToCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const distToSurface = distToCenter - node.boundingSphere.radius;
  return Math.max(0.001, distToSurface);
}

export function computeErrorPx(params: {
  errorWorld: number;
  distanceToCamera: number;
  viewportHeightPx: number;
  fovYRadians: number;
}): number {
  const { errorWorld, distanceToCamera, viewportHeightPx, fovYRadians } = params;
  const denom = 2 * distanceToCamera * Math.tan(fovYRadians / 2);
  if (denom < 1e-10) return 0;
  return (errorWorld * viewportHeightPx) / denom;
}

export function computeNodeErrorPx(
  node: ClodPageNodeRuntime,
  camera: THREE.PerspectiveCamera,
  viewportHeightPx: number,
  fovYRadians: number,
): number {
  const distance = computeNodeDistanceToCamera(node, camera);
  return computeErrorPx({
    errorWorld: node.errorWorld,
    distanceToCamera: distance,
    viewportHeightPx,
    fovYRadians,
  });
}
