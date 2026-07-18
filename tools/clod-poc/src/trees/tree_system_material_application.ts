import * as THREE from "three";
import { refreshInstancedDepthPrepassTwin } from "../rendering/veg_prepass.js";
import { TREE_LODS, TREE_SPECIES, type TreeSpeciesId } from "./tree_config.js";
import { isTreeImpostorCardGeometry, type TreeGeometryMap } from "./tree_geometry.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import {
  selectTreeSystemGeometry,
  selectTreeSystemMaterial,
} from "./tree_system_impostor_resources.js";
import { attachPackedTreeInstanceAttributes } from "./tree_system_instance_attribute_layout.js";
import type { TreeSystemMeshGrid } from "./tree_system_lifecycle.js";
import { selectTreeCpuPrepassNodes } from "./tree_system_prepass_policy.js";
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
        const material = selectTreeSystemMaterial({
          species,
          lod,
          settings: input.settings,
          materialHandle: input.materialHandle,
          impostorAtlases: input.impostorAtlases,
          impostorMaterials: input.impostorMaterials,
        });
        // The billboard impostor shader flattens vertices along camera-right;
        // on anything but the baked flat card (e.g. a retained pre-bake
        // fallback mesh) it smears geometry into dark vertical streaks. Keep
        // the regular material until the geometry swap has happened.
        mesh.material = material === input.impostorMaterials[species] && !isTreeImpostorCardGeometry(mesh.geometry)
          ? input.materialHandle.regularMaterial
          : material;
        mesh.castShadow = treeLodCastsShadow(input.settings, lod);
        refreshTreeSystemDepthTwin(input, mesh, species, lod);
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
  const depthTwin = mesh.userData.depthTwin as THREE.InstancedMesh | undefined;
  if (depthTwin) depthTwin.geometry = mesh.geometry;
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
  attachPackedTreeInstanceAttributes(geometry, safeCapacity, true);
  return geometry;
}

function refreshTreeSystemDepthTwin(
  input: ApplyTreeSystemMaterialsInput,
  mesh: THREE.InstancedMesh,
  species: TreeSpeciesId,
  lod: (typeof TREE_LODS)[number],
): void {
  if (!mesh.userData.depthTwin) return;
  const bakedImpostor = lod === "impostor" &&
    isTreeImpostorCardGeometry(mesh.geometry) &&
    input.settings.impostors.enabled &&
    input.impostorAtlases[species]?.ready === true;
  const nodes = selectTreeCpuPrepassNodes({
    lod,
    bakedImpostor,
    impostorMaterial: bakedImpostor ? input.impostorMaterials[species] : undefined,
    baseNodes: input.materialHandle.prepassNodesFor?.(lod),
  });
  refreshInstancedDepthPrepassTwin(mesh, nodes);
}
