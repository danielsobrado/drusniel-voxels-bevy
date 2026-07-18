import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import {
  decorateTreeImpostorForestLighting,
  updateTreeImpostorMaterialForestLighting,
} from "./tree_impostor_forest_lighting.js";
import type { TreeMaterialHandle } from "./tree_material.js";

export function decorateTreeNodeForestLighting(
  handle: TreeMaterialHandle,
  state: ForestLightingMaterialState | null = null,
): TreeMaterialHandle {
  decorateTreeImpostorForestLighting(handle.regularMaterial, true, state);

  handle.updateForestLighting = (next: ForestLightingMaterialState | null): void => {
    if (!updateTreeImpostorMaterialForestLighting(handle.regularMaterial, next)) {
      throw new Error("tree node material does not own the forest-lighting contract");
    }
  };
  return handle;
}
