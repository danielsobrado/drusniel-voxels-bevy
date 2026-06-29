import * as THREE from "three";
import type { TreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import {
  createTreeImpostorBlendMaterial,
  createTreeImpostorBlendNodeMaterial,
  createTreeImpostorMaterial,
  createTreeImpostorNodeMaterial,
} from "./tree_impostor_material.js";

export const TREE_IMPOSTOR_MATERIAL_SELECTION_KEY = "treeImpostorMaterialSelection";

export interface TreeImpostorMaterialSelection {
  webgpu: boolean;
  viewBlend: boolean;
}

export function createSelectedTreeImpostorMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
  selection: TreeImpostorMaterialSelection,
): THREE.Material {
  const material = createTreeImpostorMaterialForSelection(settings, atlas, selection);
  material.userData[TREE_IMPOSTOR_MATERIAL_SELECTION_KEY] = { ...selection };
  return material;
}

export function treeImpostorMaterialMatchesSelection(
  material: THREE.Material | undefined,
  selection: TreeImpostorMaterialSelection,
): boolean {
  const actual = material?.userData[TREE_IMPOSTOR_MATERIAL_SELECTION_KEY] as TreeImpostorMaterialSelection | undefined;
  return !!actual && actual.webgpu === selection.webgpu && actual.viewBlend === selection.viewBlend;
}

function createTreeImpostorMaterialForSelection(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
  selection: TreeImpostorMaterialSelection,
): THREE.Material {
  if (selection.webgpu) {
    return selection.viewBlend
      ? createTreeImpostorBlendNodeMaterial(settings, atlas)
      : createTreeImpostorNodeMaterial(settings, atlas);
  }
  return selection.viewBlend
    ? createTreeImpostorBlendMaterial(settings, atlas)
    : createTreeImpostorMaterial(settings, atlas);
}
