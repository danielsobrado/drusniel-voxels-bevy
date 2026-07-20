import type { LargePropOcclusionField, LargePropOcclusionFieldStats } from "./large_prop_occlusion_field.js";

let activeField: LargePropOcclusionField | null = null;

export function registerActiveLargePropOcclusionField(field: LargePropOcclusionField): () => void {
  activeField = field;
  return () => {
    if (activeField === field) activeField = null;
  };
}

export function readActiveLargePropOcclusionField(): LargePropOcclusionField | null {
  return activeField;
}

export function publishLargePropOcclusionCounters(stats: LargePropOcclusionFieldStats): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;

  counters["large_prop_occlusion_active_revision"] = stats.activeRevision;
  counters["large_prop_occlusion_pending_revision"] = stats.pendingRevision;
  counters["large_prop_occlusion_active_cells"] = stats.activeCells;
  counters["large_prop_occlusion_pending_cells"] = stats.pendingCells;
  counters["large_prop_occlusion_pending"] = stats.pending ? 1 : 0;
  counters["large_prop_occlusion_cells_last_step"] = stats.processedCellsLastStep;
  counters["large_prop_occlusion_swaps"] = stats.swaps;
  counters["large_prop_occlusion_readbacks"] = 0;
}
