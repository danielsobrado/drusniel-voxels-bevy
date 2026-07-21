import type { TreeSettings } from "./tree_config.js";

/**
 * Keeps the default gameplay tree path temporally stable. All distance rings and
 * impostor baking remain enabled, but LODs use hard hysteresis and a completed
 * bake rebuilds the active consumer instead of replacing its live GPU resources.
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
      swapOnBake: false,
      fallbackToPlaceholder: false,
    },
  };
}
