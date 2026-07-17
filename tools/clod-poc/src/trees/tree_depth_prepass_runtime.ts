import type { TreeLod } from "./tree_config.js";

export type TreeDepthPrepassMaxLod = "none" | Exclude<TreeLod, "impostor">;

export const TREE_DEPTH_PREPASS_MAX_LODS = ["none", "near", "mid", "far"] as const satisfies readonly TreeDepthPrepassMaxLod[];
export const DEFAULT_TREE_DEPTH_PREPASS_MAX_LOD: TreeDepthPrepassMaxLod = "none";

const TREE_LOD_RANK: Record<TreeDepthPrepassMaxLod, number> = {
  none: 0,
  near: 1,
  mid: 2,
  far: 3,
};

export function parseTreeDepthPrepassMaxLod(value: string | null | undefined): TreeDepthPrepassMaxLod {
  return TREE_DEPTH_PREPASS_MAX_LODS.includes(value as TreeDepthPrepassMaxLod)
    ? value as TreeDepthPrepassMaxLod
    : DEFAULT_TREE_DEPTH_PREPASS_MAX_LOD;
}

export function treeDepthPrepassEnabled(maxLod: TreeDepthPrepassMaxLod): boolean {
  return maxLod !== "none";
}

export function treeLodWithinDepthPrepass(maxLod: TreeDepthPrepassMaxLod, lod: TreeLod): boolean {
  if (lod === "impostor") return false;
  return TREE_LOD_RANK[lod] <= TREE_LOD_RANK[maxLod];
}
