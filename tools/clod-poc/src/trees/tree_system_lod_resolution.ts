import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";

export interface ResolveTreeSystemLodInput {
  species: TreeSpeciesId;
  lod: TreeLod;
  settings: TreeSettings;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
}

/** Resolves the actual mesh LOD to draw without changing the primary LOD count. */
export function resolveTreeSystemLod(input: ResolveTreeSystemLodInput): TreeLod {
  // The impostor distance band must stay cheap while atlases are pending or unavailable.
  // Geometry selection chooses the placeholder impostor until a baked atlas is ready.
  return input.lod;
}
