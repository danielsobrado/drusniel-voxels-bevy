import * as THREE from "three";
import { instancedDepthPrepassTwin, type PrepassNodes } from "../rendering/veg_prepass.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSpeciesId } from "./tree_config.js";
import type { TreeInstance } from "./tree_instances.js";
import type { TreeSystemMeshGrid } from "./tree_system_lifecycle.js";
import { attachPackedTreeInstanceAttributes } from "./tree_system_instance_attribute_layout.js";

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
  const geometry = shareTemplateGeometry(input.geometry);
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

/** Marks which attribute names on a patch geometry belong to the shared species/LOD template. */
const SHARED_TEMPLATE_ATTRIBUTES_KEY = "treeSharedTemplateAttributes";

/**
 * Patch geometry that references the species/LOD template's vertex buffers rather than
 * copying them. Only the per-patch instance attributes are newly allocated. Cloning the
 * template for every patch × species × LOD exhausted the heap on large worlds, since a
 * single near-LOD template is six figures of vertices.
 */
function shareTemplateGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  if (source.index) geometry.setIndex(source.index);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.userData[SHARED_TEMPLATE_ATTRIBUTES_KEY] = Object.keys(source.attributes);
  return geometry;
}

/**
 * Releases a patch geometry, keeping the shared template buffers alive. The template
 * attributes and index are detached first, so three's dispose event only frees the
 * patch-owned instance attributes instead of buffers other patches still draw from.
 */
export function disposeTreePatchGeometry(geometry: THREE.BufferGeometry): void {
  const shared = geometry.userData[SHARED_TEMPLATE_ATTRIBUTES_KEY] as string[] | undefined;
  if (shared) {
    for (const name of shared) geometry.deleteAttribute(name);
    geometry.setIndex(null);
  }
  geometry.dispose();
}

export function attachTreePatchInstanceAttributes(
  geometry: THREE.BufferGeometry,
  lod: TreeLod,
  capacity: number,
): void {
  const safeCapacity = Math.max(1, Math.floor(capacity));
  attachPackedTreeInstanceAttributes(geometry, safeCapacity, lod === "impostor");
}
