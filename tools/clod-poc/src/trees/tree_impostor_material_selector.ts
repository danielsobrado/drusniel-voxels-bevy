import * as THREE from "three";
import type { TreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import {
  createTreeImpostorBlendMaterial,
  createTreeImpostorBlendNodeMaterial,
  createTreeImpostorMaterial,
  createTreeImpostorNodeMaterial,
} from "./tree_impostor_material.js";

export interface TreeImpostorMaterialSelection {
  webgpu: boolean;
  viewBlend: boolean;
}

export function createSelectedTreeImpostorMaterial(
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
