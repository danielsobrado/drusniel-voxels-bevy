import type { TreeSettings, TreeSpeciesId } from "./tree_config.js";
import type { TreeInstance } from "./tree_instances.js";

export interface TreeSystemLightingProxy {
  x: number;
  z: number;
  height: number;
  scale: number;
  crownRadius: number;
  species: TreeSpeciesId;
}

export interface TreeSystemLightingProxyPatch {
  visible: boolean;
  instances: TreeInstance[];
}

export function buildTreeLightingProxy(settings: TreeSettings, instance: TreeInstance): TreeSystemLightingProxy {
  const species = settings.species[instance.species];
  const crownRadius = species.crownRadiusM * instance.scale;
  return {
    x: instance.position[0],
    z: instance.position[2],
    height: (species.trunkHeightM + species.crownRadiusM * 2) * instance.scale,
    scale: instance.scale,
    crownRadius,
    species: instance.species,
  };
}

export function buildVisibleTreeLightingProxies(
  settings: TreeSettings,
  patches: readonly TreeSystemLightingProxyPatch[],
): TreeSystemLightingProxy[] {
  const proxies: TreeSystemLightingProxy[] = [];
  for (const patch of patches) {
    if (!patch.visible) continue;
    for (const instance of patch.instances) proxies.push(buildTreeLightingProxy(settings, instance));
  }
  return proxies;
}
