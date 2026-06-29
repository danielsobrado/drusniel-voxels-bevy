import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import type { TreeGpuRingOutputBuffers } from "../gpu/tree_ring_compute.js";
import { TREE_GPU_RING_GROUP_COUNT } from "../gpu/tree_ring_compute.js";
import type { TreeLod, TreeSpeciesId } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";

export type TreeGpuRingMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;

export type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

export interface TreeWebGpuBackendBufferAccess {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export interface TreeGpuRingDrawResourceBundle {
  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  outputBuffers: TreeGpuRingOutputBuffers;
}

export function createTreeGpuRingDrawBuffers(
  backend: TreeWebGpuBackendBufferAccess,
  maxInstancesPerGroup: number,
  groupCount = TREE_GPU_RING_GROUP_COUNT,
): TreeGpuRingDrawResourceBundle {
  const count = Math.max(1, Math.floor(maxInstancesPerGroup));
  const sharedInstanceCount = count * groupCount;
  const indirect = new StorageBufferAttribute(new Uint32Array(groupCount * 5), 5);
  indirect.name = "tree-ring-indirect";
  backend.createIndirectStorageAttribute(indirect);
  const cell = createTreeGpuRingStorageInstancedAttribute(backend, "cell", sharedInstanceCount);
  return {
    cell,
    indirect,
    outputBuffers: {
      cell: treeGpuBufferForAttribute(backend, cell),
      indirectArgs: treeGpuBufferForAttribute(backend, indirect),
    },
  };
}

export function createTreeGpuRingStorageInstancedAttribute(
  backend: TreeWebGpuBackendBufferAccess,
  name: string,
  count: number,
): StorageInstancedBufferAttribute {
  const attribute = new StorageInstancedBufferAttribute(Math.max(1, Math.floor(count)), 4);
  attribute.name = `tree-ring-${name}`;
  backend.createStorageAttribute(attribute);
  return attribute;
}

export function createTreeGpuRingInstancedGeometry(
  source: THREE.BufferGeometry,
  instanceCount: number,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
  worldCells: number,
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(source.getIndex());
  for (const name of Object.keys(source.attributes)) {
    geometry.setAttribute(name, source.getAttribute(name));
  }
  geometry.instanceCount = Math.max(1, Math.floor(instanceCount));
  setTreeGpuRingIndirect(geometry, indirect, indirectOffset);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(worldCells + 1, 256, worldCells + 1),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  return geometry;
}

export function createTreeGpuRingMesh(
  geometry: THREE.InstancedBufferGeometry,
  materialHandle: TreeMaterialHandle,
  species: TreeSpeciesId,
  lod: TreeLod,
  debugColorByLod: boolean,
  castShadow: boolean,
): TreeGpuRingMesh {
  const mesh = new THREE.Mesh(
    geometry,
    debugColorByLod ? materialHandle.debugMaterials[lod] : materialHandle.regularMaterial,
  );
  mesh.name = `trees-ring-gpu-${species}-${lod}`;
  mesh.frustumCulled = false;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  return mesh;
}

export function setTreeGpuRingMeshesVisible(meshes: Iterable<THREE.Object3D>, visible: boolean): void {
  for (const mesh of meshes) mesh.visible = visible;
}

export function setTreeGpuRingIndirect(
  geometry: THREE.InstancedBufferGeometry,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
): void {
  const indirectGeometry = geometry as IndirectInstancedBufferGeometry;
  if (!indirectGeometry.setIndirect) {
    throw new Error("tree GPU ring requires InstancedBufferGeometry.setIndirect support");
  }
  indirectGeometry.setIndirect(indirect, indirectOffset);
}

export function treeGpuBufferForAttribute(
  backend: TreeWebGpuBackendBufferAccess,
  attribute: THREE.BufferAttribute,
): GPUBuffer {
  const buffer = backend.get(attribute).buffer;
  if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "tree ring attribute"}`);
  return buffer;
}
