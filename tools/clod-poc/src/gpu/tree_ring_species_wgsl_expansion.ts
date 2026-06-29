import {
  replaceTreeRingIndexCountFunction,
  replaceTreeRingParamsStruct,
  treeRingSixSpeciesIndexCountSource,
  treeRingSixSpeciesParamsStructSource,
} from "./tree_ring_species_wgsl_params.js";
import {
  replaceTreeRingSpeciesSelection,
  treeRingSixSpeciesWgslSelectionSource,
} from "./tree_ring_species_wgsl_selection.js";

export function applyTreeRingSpeciesWgslExpansion(source: string, speciesCount: number): string {
  if (speciesCount <= 3) return source;
  if (speciesCount !== 6) {
    throw new Error(`Unsupported tree ring species count ${speciesCount}; expected 3 or 6`);
  }
  return replaceTreeRingSpeciesSelection(
    replaceTreeRingIndexCountFunction(
      replaceTreeRingParamsStruct(source, treeRingSixSpeciesParamsStructSource()),
      treeRingSixSpeciesIndexCountSource(),
    ),
    treeRingSixSpeciesWgslSelectionSource(),
  );
}
