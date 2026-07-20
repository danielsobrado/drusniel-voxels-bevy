import * as THREE from "three";
import type { TreeSettings } from "./tree_config.js";

const TREE_GPU_FRUSTUM_MATRIX = new THREE.Matrix4();
const TREE_GPU_FRUSTUM = new THREE.Frustum();

export function treeSystemUsesGpuRingDraw(settings: TreeSettings): boolean {
  const gpu = settings.gpu;
  return settings.enabled && gpu.enabled && gpu.scatterEnabled && gpu.cullEnabled && !gpu.debugForceCpu;
}

export function treeCpuPatchCrossfadeEnabled(settings: TreeSettings): boolean {
  return settings.lod.crossfadeEnabled && settings.lod.ditherEnabled && settings.lod.crossfadeBandM > 0;
}

export function treeCpuPatchesAreGpuFallback(settings: TreeSettings): boolean {
  const gpu = settings.gpu;
  if (!gpu.enabled) return false;
  return gpu.fallbackToCpu || gpu.debugForceCpu || !gpu.scatterEnabled || !gpu.cullEnabled;
}

export function packTreeSystemGpuFrustumPlanes(camera?: THREE.Camera, out = new Float32Array(24)): Float32Array {
  if (!camera) {
    out.fill(0);
    for (let i = 0; i < 6; i++) out[i * 4 + 3] = 1_000_000;
    return out;
  }

  (camera as THREE.Camera & { updateProjectionMatrix?: () => void }).updateProjectionMatrix?.();
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  TREE_GPU_FRUSTUM_MATRIX.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  TREE_GPU_FRUSTUM.setFromProjectionMatrix(TREE_GPU_FRUSTUM_MATRIX);
  for (let i = 0; i < 6; i++) {
    const plane = TREE_GPU_FRUSTUM.planes[i];
    const offset = i * 4;
    out[offset] = plane.normal.x;
    out[offset + 1] = plane.normal.y;
    out[offset + 2] = plane.normal.z;
    out[offset + 3] = plane.constant;
  }
  return out;
}
