import * as THREE from "three";
import type { TreeSettings } from "./tree_config.js";
import { packTreeSystemGpuFrustumPlanes, treeSystemUsesGpuRingDraw } from "./tree_system_gpu_policy.js";

export function treeUsesGpuRingDraw(settings: TreeSettings): boolean {
  return treeSystemUsesGpuRingDraw(settings);
}

export function packTreeGpuFrustumPlanes(camera?: THREE.Camera, out = new Float32Array(24)): Float32Array {
  return packTreeSystemGpuFrustumPlanes(camera, out);
}
