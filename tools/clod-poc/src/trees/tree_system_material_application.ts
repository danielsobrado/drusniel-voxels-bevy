import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES, type TreeSpeciesId } from "./tree_config.js";
import type { TreeGeometryMap } from "./tree_geometry.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import {
  selectTreeSystemGeometry,
  selectTreeSystemMaterial,
} from "./tree_system_impostor_resources.js";
import {
  TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES,
  TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
} from "./tree_impostor_blend_geometry.js";
import { TREE_IMPOSTOR_BLEND_SAMPLE_COUNT } from "./tree_impostor_runtime.js";
import { TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME } from "./tree_system_instance_attributes.js";
import type { TreeSystemMeshGrid } from "./tree_system_lifecycle.js";
import { treeLodCastsShadow } from "./tree_system_shadow_policy.js";
import type { TreeSettings } from "./tree_config.js";

export interface TreeSystemMaterialPatch {
  meshes: TreeSystemMeshGrid;
}

export interface ApplyTreeSystemMaterialsInput {
  patches: readonly TreeSystemMaterialPatch[];
  settings: TreeSettings;
  materialHandle: TreeMaterialHandle;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  impostorMaterials: Partial<Record<TreeSpeciesId, THREE.Material>>;
}

export interface ReplaceTreeSystemImpostorGeometriesInput {
  patches: readonly TreeSystemMaterialPatch[];
  settings: TreeSettings;
  geometries: TreeGeometryMap;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  bakedImpostorGeometries: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>>;
  includeBlendAttributes?: boolean;
  meshBoundsState?: WeakMap<THREE.InstancedMesh, unknown>;
}

export function applyTreeSystemMaterials(input: ApplyTreeSystemMaterialsInput): void {
  for (const patch of input.patches) {
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const mesh = patch.meshes[species][lod];
        mesh.material = selectTreeSystemMaterial({
          species,
          lod,
          settings: input.settings,
          materialHandle: input.materialHandle,
          impostorAtlases: input.impostorAtlases,
          impostorMaterials: input.impostorMaterials,
        });
        mesh.castShadow = treeLodCastsShadow(input.settings, lod);
      }
    }
  }
}

export function replaceTreeSystemImpostorGeometries(input: ReplaceTreeSystemImpostorGeometriesInput): void {
  for (const patch of input.patches) {
    for (const species of TREE_SPECIES) {
      const mesh = patch.meshes[species].impostor;
      const source = selectTreeSystemGeometry({
        species,
        lod: "impostor",
        settings: input.settings,
        geometries: input.geometries,
        impostorAtlases: input.impostorAtlases,
        bakedImpostorGeometries: input.bakedImpostorGeometries,
      });
      replaceTreeSystemImpostorGeometry(mesh, source, input.includeBlendAttributes ?? true, input.meshBoundsState);
    }
  }
}

export function replaceTreeSystemImpostorGeometry(
  mesh: THREE.InstancedMesh,
  source: THREE.BufferGeometry,
  includeBlendAttributes = true,
  meshBoundsState?: WeakMap<THREE.InstancedMesh, unknown>,
): void {
  const oldGeometry = mesh.geometry;
  mesh.geometry = createTreeSystemImpostorGeometryForCapacity(source, mesh.instanceMatrix.count, includeBlendAttributes);
  oldGeometry.dispose();
  meshBoundsState?.delete(mesh);
}

export function createTreeSystemImpostorGeometryForCapacity(
  source: THREE.BufferGeometry,
  capacity: number,
  _includeBlendAttributes = true,
): THREE.BufferGeometry {
  const safeCapacity = Math.max(0, Math.floor(capacity));
  const geometry = source.clone();
  geometry.setAttribute("treeWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity * 2), 2));
  geometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity).fill(1), 1));
  geometry.setAttribute("treeLodDitherRole", new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity), 1));
  geometry.setAttribute("treeImpostorUvRect", new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity * 4), 4));
  geometry.setAttribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME, new THREE.InstancedBufferAttribute(new Float32Array(safeCapacity * 4), 4));
  attachTreeSystemImpostorBlendAttributes(geometry, safeCapacity);
  return geometry;
}

function attachTreeSystemImpostorBlendAttributes(geometry: THREE.BufferGeometry, capacity: number): void {
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
