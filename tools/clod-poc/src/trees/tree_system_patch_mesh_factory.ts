import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSpeciesId } from "./tree_config.js";
import type { TreeInstance } from "./tree_instances.js";
import type { TreeSystemMeshGrid } from "./tree_system_lifecycle.js";

export interface TreePatchMeshFactoryInput {
  nodeId: string;
  instances: readonly TreeInstance[];
  geometryFor(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry;
  materialFor(species: TreeSpeciesId, lod: TreeLod): THREE.Material;
  castsShadow(lod: TreeLod): boolean;
}

export interface TreePatchMeshFactoryResult {
  group: THREE.Group;
  meshes: TreeSystemMeshGrid;
}

export function createTreePatchMeshGroup(input: TreePatchMeshFactoryInput): TreePatchMeshFactoryResult {
  const group = new THREE.Group();
  group.name = `tree-patch-${input.nodeId}`;
  const meshes = {} as TreeSystemMeshGrid;
  for (const species of TREE_SPECIES) {
    const speciesCapacity = Math.max(1, input.instances.filter((instance) => instance.species === species).length);
    meshes[species] = {} as Record<TreeLod, THREE.InstancedMesh>;
    for (const lod of TREE_LODS) {
      const mesh = createTreePatchLodMesh({
        nodeId: input.nodeId,
        species,
        lod,
        capacity: speciesCapacity,
        geometry: input.geometryFor(species, lod),
        material: input.materialFor(species, lod),
        castShadow: input.castsShadow(lod),
      });
      meshes[species][lod] = mesh;
      group.add(mesh);
    }
  }
  return { group, meshes };
}

export interface TreePatchLodMeshInput {
  nodeId: string;
  species: TreeSpeciesId;
  lod: TreeLod;
  capacity: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
}

export function createTreePatchLodMesh(input: TreePatchLodMeshInput): THREE.InstancedMesh {
  const capacity = Math.max(1, Math.floor(input.capacity));
  const geometry = input.geometry.clone();
  attachTreePatchInstanceAttributes(geometry, input.lod, capacity);
  const mesh = new THREE.InstancedMesh(geometry, input.material, capacity);
  mesh.name = `trees-${input.nodeId}-${input.species}-${input.lod}`;
  mesh.count = 0;
  mesh.frustumCulled = true;
  mesh.visible = false;
  mesh.castShadow = input.castShadow;
  mesh.receiveShadow = false;
  return mesh;
}

export function attachTreePatchInstanceAttributes(
  geometry: THREE.BufferGeometry,
  lod: TreeLod,
  capacity: number,
): void {
  const safeCapacity = Math.max(1, Math.floor(capacity));
  geometry.setAttribute("treeWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity * 2), 2));
  geometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity).fill(1), 1));
  geometry.setAttribute("treeLodDitherRole", new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity), 1));
  if (lod === "impostor") {
    geometry.setAttribute("treeImpostorUvRect", new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity * 4), 4));
  }
}
