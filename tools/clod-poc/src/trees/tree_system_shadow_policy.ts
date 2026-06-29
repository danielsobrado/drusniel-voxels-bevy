import { TREE_LODS, type TreeLod, type TreeSettings } from "./tree_config.js";

export function treeLodCastsShadow(settings: TreeSettings, lod: TreeLod): boolean {
  const maxLod = settings.lod.shadowsMaxLod;
  if (maxLod === "none") return false;
  return TREE_LODS.indexOf(lod) <= TREE_LODS.indexOf(maxLod);
}
