import type { TreeSettings } from "../trees/tree_config.js";
import type { VegetationLodConfig } from "./vegetation_lod_config.js";

export function applyVegetationLodToTrees(
  settings: TreeSettings,
  vegetation: VegetationLodConfig,
): TreeSettings {
  return {
    ...settings,
    lod: {
      ...settings.lod,
      impostorEndM: vegetation.canopyHandoff.endM,
      canopyFadeStartM: vegetation.canopyHandoff.startM,
      canopyFadeEndM: vegetation.canopyHandoff.endM,
    },
  };
}
