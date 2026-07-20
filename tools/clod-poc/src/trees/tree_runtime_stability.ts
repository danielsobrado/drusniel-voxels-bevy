import type { TreeSettings } from "./tree_config.js";

/**
 * Keeps the default gameplay tree path conservative for terrain visibility while
 * preserving configured LOD crossfades whenever a positive band is present.
 * Impostor baking follows the tree config: without baked atlases the impostor
 * band renders opaque box/octahedron proxies, which read as floating black
 * shapes at distance.
 */
export function stabilizeRuntimeTreeSettings(settings: TreeSettings): TreeSettings {
  return {
    ...settings,
    lod: {
      ...settings.lod,
      crossfadeEnabled: settings.lod.crossfadeEnabled && settings.lod.crossfadeBandM > 0,
      crossfadeBandM: Math.max(0, settings.lod.crossfadeBandM),
      ditherEnabled: settings.lod.ditherEnabled && settings.lod.crossfadeBandM > 0,
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
