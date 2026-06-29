import type { PropGpuStatus } from "./prop_types.js";

export interface PropStats {
  totalInstances: number;
  cellsTotal: number;
  cellsVisible: number;
  cellsCulled: number;
  instancesVisible: number;
  instancesCulled: number;
  farCellsSkipped: number;
  drawCallsOpaque: number;
  drawCallsTotal: number;
  trianglesByLod: number[];
  shadowCasters: number;
  collidersActive: number;
  billboardInstances: number;
  gpuStatus: PropGpuStatus;
  gpuCandidateCount: number;
  gpuVisibleCount: number;
  gpuOverflowed: boolean;
  gpuDispatchMs: number | null;
  updateMs: number;
}

export const EMPTY_PROP_STATS: PropStats = {
  totalInstances: 0,
  cellsTotal: 0,
  cellsVisible: 0,
  cellsCulled: 0,
  instancesVisible: 0,
  instancesCulled: 0,
  farCellsSkipped: 0,
  drawCallsOpaque: 0,
  drawCallsTotal: 0,
  trianglesByLod: [],
  shadowCasters: 0,
  collidersActive: 0,
  billboardInstances: 0,
  gpuStatus: "disabled",
  gpuCandidateCount: 0,
  gpuVisibleCount: 0,
  gpuOverflowed: false,
  gpuDispatchMs: null,
  updateMs: 0,
};

export function syncPropStatsToHooks(stats: PropStats, counters: Record<string, number>): void {
  counters["props.instances_total"] = stats.totalInstances;
  counters["props.cells_visible"] = stats.cellsVisible;
  counters["props.cells_culled"] = stats.cellsCulled;
  counters["props.instances_visible"] = stats.instancesVisible;
  counters["props.instances_culled"] = stats.instancesCulled;
  counters["props.draw_calls"] = stats.drawCallsTotal;
  counters["props.triangles_lod0"] = stats.trianglesByLod[0] ?? 0;
  counters["props.triangles_lod1"] = stats.trianglesByLod[1] ?? 0;
  counters["props.triangles_lod2"] = stats.trianglesByLod[2] ?? 0;
  counters["props.triangles_lod3"] = stats.trianglesByLod[3] ?? 0;
  counters["props.shadow_casters"] = stats.shadowCasters;
  counters["props.colliders_active"] = stats.collidersActive;
  counters["props.billboard_instances"] = stats.billboardInstances;
  counters["props.gpu_ring_active"] = stats.gpuStatus === "ring" ? 1 : 0;
  counters["props.gpu_fallback_cpu"] = stats.gpuStatus === "fallback-cpu" ? 1 : 0;
  counters["props.gpu_candidates"] = stats.gpuCandidateCount;
  counters["props.gpu_visible"] = stats.gpuVisibleCount;
  counters["props.gpu_overflowed"] = stats.gpuOverflowed ? 1 : 0;
  counters["props.gpu_dispatch_ms"] = stats.gpuDispatchMs === null ? 0 : Math.round(stats.gpuDispatchMs * 100) / 100;
  counters["props.update_ms"] = Math.round(stats.updateMs * 100) / 100;
}
