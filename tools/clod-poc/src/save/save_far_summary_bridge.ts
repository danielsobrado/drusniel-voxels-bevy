import type { SavedBounds2D } from "./world_metadata/metadata_schema.js";

export interface SaveInvalidationTarget {
  markSaveInvalidationBounds(bounds: SavedBounds2D): void;
}

export interface SaveFarInvalidationCounters {
  save_far_invalidation_count: number;
  save_far_invalidation_last_min_x: number;
  save_far_invalidation_last_min_z: number;
  save_far_invalidation_last_max_x: number;
  save_far_invalidation_last_max_z: number;
  save_far_invalidation_errors: number;
}

const targets = new Set<SaveInvalidationTarget>();
let counters: Partial<SaveFarInvalidationCounters> | null = null;

function publishBounds(bounds: SavedBounds2D): void {
  if (!counters) return;
  counters.save_far_invalidation_count = (counters.save_far_invalidation_count ?? 0) + 1;
  counters.save_far_invalidation_last_min_x = bounds.minX;
  counters.save_far_invalidation_last_min_z = bounds.minZ;
  counters.save_far_invalidation_last_max_x = bounds.maxX;
  counters.save_far_invalidation_last_max_z = bounds.maxZ;
}

function publishError(): void {
  if (!counters) return;
  counters.save_far_invalidation_errors = (counters.save_far_invalidation_errors ?? 0) + 1;
}

export function seedSaveFarInvalidationCounters(target: Partial<SaveFarInvalidationCounters>): void {
  target.save_far_invalidation_count = target.save_far_invalidation_count ?? 0;
  target.save_far_invalidation_last_min_x = target.save_far_invalidation_last_min_x ?? 0;
  target.save_far_invalidation_last_min_z = target.save_far_invalidation_last_min_z ?? 0;
  target.save_far_invalidation_last_max_x = target.save_far_invalidation_last_max_x ?? 0;
  target.save_far_invalidation_last_max_z = target.save_far_invalidation_last_max_z ?? 0;
  target.save_far_invalidation_errors = target.save_far_invalidation_errors ?? 0;
}

export function attachSaveFarInvalidationCounters(target: Partial<SaveFarInvalidationCounters> | null): void {
  counters = target;
  if (target) seedSaveFarInvalidationCounters(target);
}

export function registerSaveInvalidationTarget(target: SaveInvalidationTarget): void {
  targets.add(target);
}

export function unregisterSaveInvalidationTarget(target: SaveInvalidationTarget): void {
  targets.delete(target);
}

export function clearSaveInvalidationTargets(): void {
  targets.clear();
}

export function markSaveInvalidationBounds(bounds: SavedBounds2D): void {
  publishBounds(bounds);
  for (const target of targets) {
    try {
      target.markSaveInvalidationBounds(bounds);
    } catch (error) {
      publishError();
      console.warn("[save-far-summary-bridge] invalidation target failed", error);
    }
  }
}
