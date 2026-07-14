export const TREE_VARIANT_HASH_SALT = 1103;
export const TREE_VARIANT_HASH_X = 127.1;
export const TREE_VARIANT_HASH_Z = 311.7;
export const TREE_VARIANT_HASH_SCALE = 43758.5453123;

export function treeVariantPhase(x: number, z: number, seed: number): number {
  const px = x + seed * 0.013 + TREE_VARIANT_HASH_SALT;
  const pz = z + seed * 0.037 - TREE_VARIANT_HASH_SALT;
  return fract(Math.sin(px * TREE_VARIANT_HASH_X + pz * TREE_VARIANT_HASH_Z) * TREE_VARIANT_HASH_SCALE);
}

export function treeVariantIndex(
  x: number,
  z: number,
  seed: number,
  variantCount: number,
): number {
  const count = Math.max(1, Math.floor(Number.isFinite(variantCount) ? variantCount : 1));
  return Math.min(count - 1, Math.floor(treeVariantPhase(x, z, seed) * count));
}

export function treeAtlasVariantIndex(structuralVariant: number, atlasVariantCount: number): number {
  const count = Math.max(1, Math.floor(Number.isFinite(atlasVariantCount) ? atlasVariantCount : 1));
  const variant = Math.max(0, Math.floor(Number.isFinite(structuralVariant) ? structuralVariant : 0));
  return variant % count;
}

function fract(value: number): number {
  return value - Math.floor(value);
}
