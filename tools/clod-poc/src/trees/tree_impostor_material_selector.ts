import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { TreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import { decorateTreeImpostorForestLighting } from "./tree_impostor_forest_lighting.js";
import { createLiveTreeImpostorMaterial } from "./tree_impostor_live_material.js";

export const TREE_IMPOSTOR_MATERIAL_SELECTION_KEY = "treeImpostorMaterialSelection";

export interface TreeImpostorMaterialSelection {
  webgpu: boolean;
  viewBlend: boolean;
}

export function createSelectedTreeImpostorMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
  selection: TreeImpostorMaterialSelection,
  lighting?: EnvironmentLighting,
  forestLighting: ForestLightingMaterialState | null = null,
): THREE.Material {
  const material = createLiveTreeImpostorMaterial(settings, atlas, selection, lighting);
  try {
    decorateTreeImpostorForestLighting(material, selection.webgpu, forestLighting);
    material.userData[TREE_IMPOSTOR_MATERIAL_SELECTION_KEY] = { ...selection };
    return material;
  } catch (error) {
    material.dispose();
    throw error;
  }
}

export function treeImpostorMaterialMatchesSelection(
  material: THREE.Material | undefined,
  selection: TreeImpostorMaterialSelection,
): boolean {
  const actual = material?.userData[TREE_IMPOSTOR_MATERIAL_SELECTION_KEY] as TreeImpostorMaterialSelection | undefined;
  return !!actual && actual.webgpu === selection.webgpu && actual.viewBlend === selection.viewBlend;
}
