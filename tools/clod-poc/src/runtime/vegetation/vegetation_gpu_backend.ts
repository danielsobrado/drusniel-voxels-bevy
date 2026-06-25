import * as THREE from "three";

export interface VegetationGpuBackend {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export function resolveVegetationGpuBackend(
  renderer: import("three/webgpu").WebGPURenderer | THREE.WebGLRenderer,
  isWebGpu: boolean,
): VegetationGpuBackend | null {
  if (!isWebGpu) return null;
  return (renderer as unknown as import("three/webgpu").WebGPURenderer).backend as unknown as VegetationGpuBackend;
}
