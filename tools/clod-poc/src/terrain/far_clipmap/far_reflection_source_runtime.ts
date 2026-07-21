import type { FarReflectionSource, FarReflectionSourceStats } from "./far_reflection_source.js";

let activeSource: FarReflectionSource | null = null;
let activeSourceGeneration = 0;

export function registerActiveFarReflectionSource(source: FarReflectionSource): () => void {
  activeSource = source;
  activeSourceGeneration += 1;
  return () => {
    if (activeSource !== source) return;
    activeSource = null;
    activeSourceGeneration += 1;
  };
}

export function readActiveFarReflectionSource(): FarReflectionSource | null {
  return activeSource;
}

export function readActiveFarReflectionSourceGeneration(): number {
  return activeSourceGeneration;
}

export function publishFarReflectionSourceCounters(stats: FarReflectionSourceStats): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;

  counters["far_reflection_source_registration_generation"] = activeSourceGeneration;
  counters["far_reflection_source_active_generation"] = stats.activeGeneration;
  counters["far_reflection_source_source_revision"] = stats.activeSourceRevision;
  counters["far_reflection_source_prop_revision"] = stats.activePropRevision;
  counters["far_reflection_source_pending"] = stats.pending ? 1 : 0;
  counters["far_reflection_source_pending_cells"] = stats.pendingCells;
  counters["far_reflection_source_cells_last_step"] = stats.processedCellsLastStep;
  counters["far_reflection_source_fallback_samples_total"] = stats.fallbackSamplesTotal;
  counters["far_reflection_source_exception_samples_total"] = stats.exceptionSamplesTotal;
  counters["far_reflection_source_swaps"] = stats.swaps;
  counters["far_reflection_source_readbacks"] = 0;
}
