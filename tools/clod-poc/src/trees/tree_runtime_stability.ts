import type { TreeSettings } from "./tree_config.js";

/**
 * Keeps the default gameplay tree path conservative until terrain visibility
 * and temporal LOD transitions pass visual soak tests. Impostor baking follows
 * the tree config: without baked atlases the impostor band renders opaque
 * box/octahedron proxies, which read as floating black shapes at distance.
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
      fallbackToPlaceholder: false,
    },
  };
}
