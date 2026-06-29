import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES } from "./tree_config.js";
import type { TreeSystemMeshGrid } from "./tree_system_lifecycle.js";

export interface TreeMeshWriteState {
  counts: Map<THREE.InstancedMesh, number>;
  matrixChanged: Map<THREE.InstancedMesh, boolean>;
  worldXZChanged: Map<THREE.InstancedMesh, boolean>;
  impostorUvChanged: Map<THREE.InstancedMesh, boolean>;
  fadeChanged: Map<THREE.InstancedMesh, boolean>;
}

export function createTreeMeshWriteState(): TreeMeshWriteState {
  return {
    counts: new Map(),
    matrixChanged: new Map(),
    worldXZChanged: new Map(),
    impostorUvChanged: new Map(),
    fadeChanged: new Map(),
  };
}

export function resetTreeMeshWriteStateForGrid(meshes: TreeSystemMeshGrid, write: TreeMeshWriteState): void {
  for (const species of TREE_SPECIES) {
    for (const lod of TREE_LODS) {
      resetTreeMeshWriteState(meshes[species][lod], write);
    }
  }
}

export function resetTreeMeshWriteState(mesh: THREE.InstancedMesh, write: TreeMeshWriteState): void {
  write.counts.set(mesh, 0);
  write.matrixChanged.set(mesh, false);
  write.worldXZChanged.set(mesh, false);
  write.impostorUvChanged.set(mesh, false);
  write.fadeChanged.set(mesh, false);
}

export function treeMeshWriteCount(mesh: THREE.InstancedMesh, write: TreeMeshWriteState): number {
  return write.counts.get(mesh) ?? 0;
}

export function incrementTreeMeshWriteCount(mesh: THREE.InstancedMesh, write: TreeMeshWriteState): number {
  const next = treeMeshWriteCount(mesh, write) + 1;
  write.counts.set(mesh, next);
  return next;
}

export function markTreeMeshMatrixChanged(mesh: THREE.InstancedMesh, write: TreeMeshWriteState): void {
  write.matrixChanged.set(mesh, true);
}

export function markTreeMeshWorldXZChanged(mesh: THREE.InstancedMesh, write: TreeMeshWriteState): void {
  write.worldXZChanged.set(mesh, true);
}

export function markTreeMeshImpostorUvChanged(mesh: THREE.InstancedMesh, write: TreeMeshWriteState): void {
  write.impostorUvChanged.set(mesh, true);
}

export function markTreeMeshFadeChanged(mesh: THREE.InstancedMesh, write: TreeMeshWriteState): void {
  write.fadeChanged.set(mesh, true);
}
