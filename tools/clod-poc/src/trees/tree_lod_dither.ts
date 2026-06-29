export const TREE_LOD_DITHER_PRIMARY_ROLE = 0;
export const TREE_LOD_DITHER_SECONDARY_ROLE = 1;

export type TreeLodDitherMaskRole = typeof TREE_LOD_DITHER_PRIMARY_ROLE | typeof TREE_LOD_DITHER_SECONDARY_ROLE;

export function treeLodDitherKeeps(noise: number, fade: number, role: TreeLodDitherMaskRole): boolean {
  const n = clamp01(noise);
  const f = clamp01(fade);
  if (role === TREE_LOD_DITHER_SECONDARY_ROLE) return n >= 1 - f;
  return n < f;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
