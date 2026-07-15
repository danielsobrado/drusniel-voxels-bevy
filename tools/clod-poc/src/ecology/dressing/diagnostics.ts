import { DRESSING_CLASSES, type DressingClassId } from "./class_registry.js";

export interface DressingDiagnostics {
  dressing_enabled: number;
  dressing_class_count: number;
  dressing_clusters_active: number;
  dressing_candidates_generated: number;
  dressing_candidates_accepted: number;
  dressing_persistent_visible: number;
  dressing_parent_attached_visible: number;
  dressing_terrain_attached_visible: number;
  dressing_saved_exclusions: number;
  dressing_attachment_parents: number;
  dressing_attachment_count: number;
  dressing_invalidated_clusters: number;
  dressing_gpu_ms: number;
  dressing_main_thread_ms: number;
  dressing_overflow_count: number;
  perClass: Record<DressingClassId, { generated: number; accepted: number; visible: number }>;
}

export function createDressingDiagnostics(enabled = true): DressingDiagnostics {
  return {
    dressing_enabled: enabled ? 1 : 0,
    dressing_class_count: DRESSING_CLASSES.length,
    dressing_clusters_active: 0,
    dressing_candidates_generated: 0,
    dressing_candidates_accepted: 0,
    dressing_persistent_visible: 0,
    dressing_parent_attached_visible: 0,
    dressing_terrain_attached_visible: 0,
    dressing_saved_exclusions: 0,
    dressing_attachment_parents: 0,
    dressing_attachment_count: 0,
    dressing_invalidated_clusters: 0,
    dressing_gpu_ms: 0,
    dressing_main_thread_ms: 0,
    dressing_overflow_count: 0,
    perClass: Object.fromEntries(DRESSING_CLASSES.map((id) => [id, { generated: 0, accepted: 0, visible: 0 }])) as DressingDiagnostics["perClass"],
  };
}

export function cloneDressingDiagnostics(source: DressingDiagnostics): DressingDiagnostics {
  return {
    ...source,
    perClass: Object.fromEntries(DRESSING_CLASSES.map((id) => [id, { ...source.perClass[id] }])) as DressingDiagnostics["perClass"],
  };
}
