import {
  TREE_EXPANDED_SPECIES,
  TREE_EXPANDED_SPECIES_DEFAULTS,
  treeExpandedSpeciesNicheWeight,
  type TreeExpandedSpeciesId,
  type TreeExpandedSpeciesSample,
} from "./tree_species_expansion.js";

export interface TreeExpandedSpeciesWeightedChoice {
  species: TreeExpandedSpeciesId;
  weight: number;
}

export function expandedTreeSpeciesWeights(sample: TreeExpandedSpeciesSample): TreeExpandedSpeciesWeightedChoice[] {
  return TREE_EXPANDED_SPECIES
    .map((species) => ({
      species,
      weight: TREE_EXPANDED_SPECIES_DEFAULTS[species].weight * treeExpandedSpeciesNicheWeight(species, sample),
    }))
    .filter((entry) => entry.weight > 0);
}

export function selectExpandedTreeSpecies(
  sample: TreeExpandedSpeciesSample,
  roll: number,
): TreeExpandedSpeciesId | null {
  const weights = expandedTreeSpeciesWeights(sample);
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let cursor = clamp01(roll) * total;
  for (const entry of weights) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.species;
  }
  return weights[weights.length - 1]?.species ?? null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
