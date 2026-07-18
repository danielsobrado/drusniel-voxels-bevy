import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSpeciesId } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";

export type TreeSystemMeshGrid = Record<TreeSpeciesId, Record<TreeLod, THREE.InstancedMesh>>;

export interface TreeSystemPatchResources {
  group: THREE.Object3D;
  meshes: TreeSystemMeshGrid;
}

export function removeTreePatchResources(root: THREE.Object3D, patch: TreeSystemPatchResources): void {
  root.remove(patch.group);
  disposeTreeMeshGrid(patch.meshes);
}

export function disposeTreeMeshGrid(meshes: TreeSystemMeshGrid): void {
  for (const species of TREE_SPECIES) {
    for (const lod of TREE_LODS) {
      const mesh = meshes[species][lod];
      // The depth material is patch-owned. Geometry and instance data are shared
      // with the colour mesh and are released by the colour mesh path below.
      const depthTwin = mesh.userData.depthTwin as THREE.InstancedMesh | undefined;
      if (depthTwin) disposeMaterial(depthTwin.material);
      mesh.geometry.dispose();
      // Colour materials are shared and owned by TreeSystemAssets.
      mesh.dispose();
    }
  }
}

export function removeAndDisposeObjects(root: THREE.Object3D, objects: THREE.Object3D[]): void {
  for (const object of objects) {
    root.remove(object);
    const mesh = object as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    if (mesh.material) disposeMaterial(mesh.material);
  }
}

export function disposeTreeMaterialHandles(handles: Iterable<TreeMaterialHandle>): void {
  for (const handle of handles) handle.dispose();
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
    return;
  }
  material.dispose();
}
