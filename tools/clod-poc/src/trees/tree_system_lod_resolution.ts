import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import { treeCanUseBakedImpostor } from "./tree_system_impostor_resources.js";

export interface ResolveTreeSystemLodInput {
  species: TreeSpeciesId;
  lod: TreeLod;
  settings: TreeSettings;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
}

/** Resolves the actual mesh LOD to draw without changing the primary LOD count. */
export function resolveTreeSystemLod(input: ResolveTreeSystemLodInput): TreeLod {
  if (
    input.lod === "impostor" &&
    input.settings.impostors.enabled &&
    !treeCanUseBakedImpostor(input.settings, input.impostorAtlases, input.species) &&
    !input.settings.impostors.fallbackToPlaceholder
  ) {
    return "far";
  }
  return input.lod;
}
