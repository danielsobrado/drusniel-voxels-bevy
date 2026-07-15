export interface DressingPlacementStage {
  readonly stage: number;
  readonly name: string;
}

const PLACEMENT_STAGES: readonly DressingPlacementStage[] = Object.freeze([
  { stage: 0, name: "canonical terrain and voxel surface samples" },
  { stage: 1, name: "trees and persistent large rocks" },
  { stage: 2, name: "deadfall, stumps, snags, driftwood, large talus" },
  { stage: 3, name: "shrubs, saplings, normal understory" },
  { stage: 4, name: "parent-attached fungi, moss, lichen, vines, root ferns" },
  { stage: 5, name: "river, talus, bank, cave, and cliff dressing" },
  { stage: 6, name: "litter, twigs, chips, patches, and flowers" },
  { stage: 7, name: "grass exclusion and blending" },
]);

export function orderedPlacementStages(): readonly DressingPlacementStage[] {
  return PLACEMENT_STAGES;
}

export function executePlacementStages(run: (stage: DressingPlacementStage) => void): void {
  for (const stage of PLACEMENT_STAGES) run(stage);
}
