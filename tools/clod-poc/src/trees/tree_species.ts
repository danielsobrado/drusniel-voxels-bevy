import { TREE_SPECIES, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";

export interface WeightedTreeSpecies {
  id: TreeSpeciesId;
  weight: number;
}

export function enabledTreeSpecies(settings: TreeSettings): WeightedTreeSpecies[] {
  return TREE_SPECIES
    .map((id) => ({ id, weight: settings.species[id].enabled ? settings.species[id].weight : 0 }))
    .filter((species) => species.weight > 0);
}

export function selectTreeSpecies(settings: TreeSettings, roll: number): TreeSpeciesId | null {
  const enabled = enabledTreeSpecies(settings);
  const total = enabled.reduce((sum, species) => sum + species.weight, 0);
  if (total <= 0) return null;
  let cursor = roll * total;
  for (const species of enabled) {
    cursor -= species.weight;
    if (cursor <= 0) return species.id;
  }
  return enabled[enabled.length - 1]?.id ?? null;
}
