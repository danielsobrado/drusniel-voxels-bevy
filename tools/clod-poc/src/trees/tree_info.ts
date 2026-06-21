import type { TreeStats } from "./tree_system.js";

export function formatTreeInfoLine(treesEnabled: boolean, totalTrees: number, treeStats: TreeStats | null): string {
  return `trees: ${treesEnabled ? "enabled" : "disabled"} ${totalTrees.toLocaleString()} trees` +
    (treeStats
      ? ` patches=${treeStats.visiblePatches}/${treeStats.patches}` +
        ` lod n/m/f/i=${treeStats.nearTrees}/${treeStats.midTrees}/${treeStats.farTrees}/${treeStats.impostorTrees}`
      : "");
}
