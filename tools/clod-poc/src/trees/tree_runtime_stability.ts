import type { TreeSettings } from "./tree_config.js";

/**
 * Keeps the default gameplay tree path conservative until terrain visibility,
 * impostor hot-swapping, and temporal LOD transitions pass visual soak tests.
 */
export function stabilizeRuntimeTreeSettings(settings: TreeSettings): TreeSettings {
  return {
    ...settings,
    lod: {
      ...settings.lod,
      crossfadeEnabled: false,
      crossfadeBandM: 0,
      ditherEnabled: false,
    },
    gpu: {
      ...settings.gpu,
      terrainVisibility: {
        ...settings.gpu.terrainVisibility,
        enabled: false,
      },
    },
    impostors: {
      ...settings.impostors,
      bakeOnStart: false,
      swapOnBake: false,
      fallbackToPlaceholder: false,
    },
  };
}
