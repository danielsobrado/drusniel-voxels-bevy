import type { TreeLod, TreeSpeciesId } from "./tree_config.js";
import { TREE_LODS, TREE_SPECIES } from "./tree_config.js";

export const TREE_RING_SHADOW_CASCADE_COUNT = 4;
export const TREE_RING_SHADOW_PLANE_COUNT = 6;
export const TREE_RING_SHADOW_PLANE_WORDS = 4;

export function treeRingShadowCasterGroupCount(cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT): number {
  return treeRingShadowSafeCascadeCount(cascadeCount) * TREE_SPECIES.length * TREE_LODS.length;
}

export function treeRingShadowCasterGroupIndex(
  species: TreeSpeciesId,
  lod: TreeLod,
  cascade: number,
  cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT,
): number {
  const safeCascade = Math.min(treeRingShadowSafeCascadeCount(cascadeCount) - 1, Math.max(0, Math.floor(cascade)));
  const visibleGroup = TREE_SPECIES.indexOf(species) * TREE_LODS.length + TREE_LODS.indexOf(lod);
  return safeCascade * TREE_SPECIES.length * TREE_LODS.length + visibleGroup;
}

export function treeRingShadowCasterGroupRegion(
  species: TreeSpeciesId,
  lod: TreeLod,
  cascade: number,
  maxCastersPerGroup: number,
  cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT,
): { start: number; end: number; firstInstance: number } {
  const capacity = Math.max(0, Math.floor(maxCastersPerGroup));
  const start = treeRingShadowCasterGroupIndex(species, lod, cascade, cascadeCount) * capacity;
  return { start, end: start + capacity, firstInstance: start };
}

export function treeRingShadowCascadePlaneOffset(cascade: number): number {
  return Math.max(0, Math.floor(cascade)) * TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS;
}

export function packTreeRingShadowCascadePlanes(
  cascades: readonly ArrayLike<number>[],
  cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT,
): Float32Array {
  const safeCascadeCount = treeRingShadowSafeCascadeCount(cascadeCount);
  const out = new Float32Array(safeCascadeCount * TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS);
  for (let cascade = 0; cascade < safeCascadeCount; cascade++) {
    const source = cascades[cascade];
    if (!source) continue;
    const offset = treeRingShadowCascadePlaneOffset(cascade);
    for (let i = 0; i < Math.min(TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS, source.length); i++) {
      out[offset + i] = Number(source[i] ?? 0);
    }
  }
  return out;
}

export function treeRingShadowSafeCascadeCount(cascadeCount: number): number {
  if (!Number.isFinite(cascadeCount)) return TREE_RING_SHADOW_CASCADE_COUNT;
  return Math.max(1, Math.min(TREE_RING_SHADOW_CASCADE_COUNT, Math.floor(cascadeCount)));
}
