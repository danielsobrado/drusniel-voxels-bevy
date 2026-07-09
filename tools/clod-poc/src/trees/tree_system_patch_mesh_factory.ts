import * as THREE from "three";
import { instancedDepthPrepassTwin, type PrepassNodes } from "../rendering/veg_prepass.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSpeciesId } from "./tree_config.js";
import type { TreeInstance } from "./tree_instances.js";
import type { TreeSystemMeshGrid } from "./tree_system_lifecycle.js";
import { TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME } from "./tree_system_instance_attributes.js";
import {
  TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES,
  TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
} from "./tree_impostor_blend_geometry.js";
import { TREE_IMPOSTOR_BLEND_SAMPLE_COUNT } from "./tree_impostor_runtime.js";

export interface TreePatchMeshFactoryInput {
  nodeId: string;
  instances: readonly TreeInstance[];
  geometryFor(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry;
  materialFor(species: TreeSpeciesId, lod: TreeLod): THREE.Material;
  castsShadow(lod: TreeLod): boolean;
  /** TP-3: when present, attach a depth-only prepass twin per LOD mesh. */
  prepassNodesFor?(species: TreeSpeciesId, lod: TreeLod): PrepassNodes | undefined;
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
      // TP-3: depth-only prepass twin (instanced) so the near canopy gets
      // early-z. The twin shares the mesh's geometry + instanceMatrix; its
      // count/visibility are mirrored each frame in updateTreeMeshAfterLod.
      const prepassNodes = input.prepassNodesFor?.(species, lod);
      if (prepassNodes) {
        const twin = instancedDepthPrepassTwin(mesh, prepassNodes);
        mesh.userData.depthTwin = twin;
        group.add(twin);
      }
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
  mesh.count = capacity;
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
    geometry.setAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME, new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity * 4), 4));
    attachTreePatchImpostorBlendAttributes(geometry, safeCapacity);
  }
}

function attachTreePatchImpostorBlendAttributes(geometry: THREE.BufferGeometry, capacity: number): void {
  for (const name of TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
  }
  const weights = new Float32Array(capacity * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT);
  for (let index = 0; index < capacity; index++) weights[index * TREE_IMPOSTOR_BLEND_SAMPLE_COUNT] = 1;
  geometry.setAttribute(
    TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
    new THREE.InstancedBufferAttribute(weights, TREE_IMPOSTOR_BLEND_SAMPLE_COUNT),
  );
}
