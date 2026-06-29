import type { TreeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import { TREE_RING_INDIRECT_STRIDE_U32 } from "./tree_ring_species_layout.js";

export function treeRingWgslLayoutConstants(layout: TreeRingSpeciesLayout): string {
  return [
    `const TREE_LOD_COUNT: u32 = ${layout.lodCount}u;`,
    `const TREE_SPECIES_COUNT: u32 = ${layout.speciesCount}u;`,
    `const TREE_GROUP_COUNT: u32 = ${layout.groupCount}u;`,
    `const TREE_SHADOW_CASCADE_COUNT: u32 = ${layout.shadowCascadeCount}u;`,
    "const TREE_SHADOW_PLANE_COUNT: u32 = 6u;",
    `const TREE_SHADOW_GROUP_COUNT: u32 = ${layout.shadowGroupCount}u;`,
    `const TREE_INDIRECT_STRIDE_U32: u32 = ${TREE_RING_INDIRECT_STRIDE_U32}u;`,
  ].join("\n");
}

export function applyTreeRingWgslLayoutConstants(source: string, layout: TreeRingSpeciesLayout): string {
  const start = source.indexOf("const TREE_LOD_COUNT: u32 =");
  const endMarker = "const TREE_INDIRECT_STRIDE_U32: u32 =";
  const endStart = source.indexOf(endMarker, start);
  if (start < 0 || endStart < 0) return source;
  const end = source.indexOf(";", endStart);
  if (end < 0) return source;
  return `${source.slice(0, start)}${treeRingWgslLayoutConstants(layout)}${source.slice(end + 1)}`;
}
