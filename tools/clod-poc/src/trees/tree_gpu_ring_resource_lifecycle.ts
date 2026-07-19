import * as THREE from "three";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeGpuRingMesh } from "./tree_system_gpu_ring_draw.js";

interface DisposableObject3D extends THREE.Object3D {
  dispose?: () => void;
}

export interface TreeGpuRingOwnedResources {
  root: THREE.Object3D;
  meshes: readonly TreeGpuRingMesh[];
  prepassTwins: readonly THREE.Mesh[];
  materialHandles: Readonly<Record<string, TreeMaterialHandle>>;
}

export function disposeTreeGpuRingOwnedResources(resources: TreeGpuRingOwnedResources): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const handles = new Set<TreeMaterialHandle>();

  for (const twin of resources.prepassTwins) disposeTreeGpuRingPrepassTwin(resources.root, twin);

  for (const mesh of resources.meshes) {
    resources.root.remove(mesh);
    mesh.parent?.remove(mesh);
    geometries.add(mesh.geometry);
    disposeObjectState(mesh);
  }

  for (const geometry of geometries) geometry.dispose();
  for (const handle of Object.values(resources.materialHandles)) handles.add(handle);
  for (const handle of handles) handle.dispose();
}

export function disposeTreeGpuRingPrepassTwin(root: THREE.Object3D, twin: THREE.Mesh): void {
  root.remove(twin);
  twin.parent?.remove(twin);
  disposeMaterial(twin.material);
  disposeObjectState(twin);
}

export function disposeTreeGpuRingMeshState(mesh: THREE.Object3D): void {
  disposeObjectState(mesh);
}

function disposeObjectState(object: THREE.Object3D): void {
  (object as DisposableObject3D).dispose?.();
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of new Set(material)) item.dispose();
    return;
  }
  material.dispose();
}
