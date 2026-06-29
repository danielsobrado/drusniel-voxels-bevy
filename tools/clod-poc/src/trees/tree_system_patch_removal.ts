import type { TreeSpeciesId } from "./tree_config.js";
import type { TreeInstance } from "./tree_instances.js";

export interface TreeFallingInstance {
  position: [number, number, number];
  velocity: number;
  originalY: number;
  species: TreeSpeciesId;
  scale: number;
  rotationY: number;
  normalY: number;
}

export interface RemovableTreePatch {
  nodeId: string;
  instances: readonly TreeInstance[];
}

export interface TreePatchRemovalPlan<T extends RemovableTreePatch> {
  retained: T[];
  removed: T[];
  falling: TreeFallingInstance[];
}

export function treeInstanceToFallingInstance(instance: TreeInstance): TreeFallingInstance {
  return {
    position: [...instance.position],
    velocity: 0,
    originalY: instance.position[1],
    species: instance.species,
    scale: instance.scale,
    rotationY: instance.rotationY,
    normalY: instance.normalY,
  };
}

export function collectFallingTreeInstances<T extends RemovableTreePatch>(patches: readonly T[]): TreeFallingInstance[] {
  const falling: TreeFallingInstance[] = [];
  for (const patch of patches) {
    for (const instance of patch.instances) falling.push(treeInstanceToFallingInstance(instance));
  }
  return falling;
}

export function planTreePatchRemoval<T extends RemovableTreePatch>(
  patches: readonly T[],
  nodeIds: ReadonlySet<string>,
): TreePatchRemovalPlan<T> {
  const retained: T[] = [];
  const removed: T[] = [];
  for (const patch of patches) {
    if (nodeIds.has(patch.nodeId)) removed.push(patch);
    else retained.push(patch);
  }
  return {
    retained,
    removed,
    falling: collectFallingTreeInstances(removed),
  };
}
