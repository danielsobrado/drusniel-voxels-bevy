import type { TreeSpeciesId } from "./tree_config.js";

export const TREE_IMPOSTOR_FOLIAGE_TRANSMISSION = 0.28;
export const TREE_IMPOSTOR_HDR_MAX = 4.0;

/** The impostor atlas has no per-pixel foliage tag, so bare species disable leaf transmission. */
export function treeImpostorFoliageTransmissionWeight(species: TreeSpeciesId): number {
  return species === "dead" ? 0 : 1;
}
