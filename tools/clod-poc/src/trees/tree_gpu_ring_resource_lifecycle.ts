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

const DISPOSAL_LOG_PREFIX = "[trees-gpu-ring] resource disposal failed";

export function disposeTreeGpuRingOwnedResources(resources: TreeGpuRingOwnedResources): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const handles = new Set<TreeMaterialHandle>();

  for (const twin of resources.prepassTwins) disposeTreeGpuRingPrepassTwin(resources.root, twin);

  for (const mesh of resources.meshes) {
    resources.root.remove(mesh);
    mesh.parent?.remove(mesh);
    geometries.add(mesh.geometry);
    disposeTreeGpuRingMeshState(mesh);
  }

  for (const geometry of geometries) disposeTreeGpuRingGeometry(geometry);
  for (const handle of Object.values(resources.materialHandles)) handles.add(handle);
  for (const handle of handles) disposeTreeGpuRingMaterialHandle(handle);
}

export function disposeTreeGpuRingPrepassTwin(root: THREE.Object3D, twin: THREE.Mesh): void {
  root.remove(twin);
  twin.parent?.remove(twin);
  disposeMaterial(twin.material);
  disposeTreeGpuRingMeshState(twin);
}

export function disposeTreeGpuRingGeometry(geometry: THREE.BufferGeometry): void {
  attemptDispose("geometry", () => geometry.dispose());
}

export function disposeTreeGpuRingMaterialHandle(handle: TreeMaterialHandle): void {
  attemptDispose("material handle", () => handle.dispose());
}

export function disposeTreeGpuRingMeshState(mesh: THREE.Object3D): void {
  attemptDispose("mesh state", () => (mesh as DisposableObject3D).dispose?.());
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? new Set(material) : [material];
  for (const item of materials) attemptDispose("prepass material", () => item.dispose());
}

function attemptDispose(label: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    console.warn(`${DISPOSAL_LOG_PREFIX}: ${label}`, error);
  }
}
