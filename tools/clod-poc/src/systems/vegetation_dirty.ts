export interface VegetationDirtyQueue {
  nodeIds: string[];
  grass: boolean;
  trees: boolean;
  understory: boolean;
}

export interface VegetationDirtyDrainDeps {
  queue: VegetationDirtyQueue;
  grassEnabled: boolean;
  treesEnabled: boolean;
  understoryEnabled: boolean;
  markGrassDirty: () => void;
  markTreesDirty: () => void;
  markUnderstoryDirty: () => void;
}

export function drainVegetationDirty(deps: VegetationDirtyDrainDeps): void {
  if (!deps.queue.grass && !deps.queue.trees && !deps.queue.understory) return;
  if (deps.grassEnabled && deps.queue.grass) {
    deps.markGrassDirty();
  }
  if (deps.treesEnabled && deps.queue.trees) {
    deps.markTreesDirty();
  }
  if (deps.understoryEnabled && deps.queue.understory) {
    deps.markUnderstoryDirty();
  }
  deps.queue.grass = false;
  deps.queue.trees = false;
  deps.queue.understory = false;
  deps.queue.nodeIds.length = 0;
}
