import type { ProbeGiCascadeId } from "./types.js";

export interface ProbeGiDiagnostics {
  probe_gi_enabled: number;
  probe_gi_total_probes: number;
  probe_gi_valid_probes: number;
  probe_gi_invalid_probes: number;
  probe_gi_relocated_count: number;
  probe_gi_terrain_unknown_count: number;
  probe_gi_positioned_this_frame: number;
  probe_gi_position_ms: number;
  probe_gi_new_slab_queue: number;
  probe_gi_publish_generation: number;
  probe_gi_storage_bytes: number;
  probe_gi_cpu_storage_bytes: number;
  probe_gi_gpu_storage_bytes: number;
  probe_gi_texture_bytes: number;
  probe_gi_near_recentered_columns: number;
  probe_gi_mid_recentered_columns: number;
  probe_gi_far_recentered_columns: number;
}

export function createProbeGiDiagnostics(
  enabled: boolean,
  totalProbes: number,
  cpuStorageBytes: number,
  gpuStorageBytes: number,
  textureBytes: number,
): ProbeGiDiagnostics {
  return {
    probe_gi_enabled: enabled ? 1 : 0,
    probe_gi_total_probes: totalProbes,
    probe_gi_valid_probes: 0,
    probe_gi_invalid_probes: totalProbes,
    probe_gi_relocated_count: 0,
    probe_gi_terrain_unknown_count: 0,
    probe_gi_positioned_this_frame: 0,
    probe_gi_position_ms: 0,
    probe_gi_new_slab_queue: 0,
    probe_gi_publish_generation: 0,
    probe_gi_storage_bytes: cpuStorageBytes + gpuStorageBytes + textureBytes,
    probe_gi_cpu_storage_bytes: cpuStorageBytes,
    probe_gi_gpu_storage_bytes: gpuStorageBytes,
    probe_gi_texture_bytes: textureBytes,
    probe_gi_near_recentered_columns: 0,
    probe_gi_mid_recentered_columns: 0,
    probe_gi_far_recentered_columns: 0,
  };
}

export function setProbeGiCascadeRecenteredColumns(
  diagnostics: ProbeGiDiagnostics,
  id: ProbeGiCascadeId,
  value: number,
): void {
  diagnostics[`probe_gi_${id}_recentered_columns`] = value;
}

export function publishProbeGiDiagnostics(diagnostics: ProbeGiDiagnostics): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  for (const [name, value] of Object.entries(diagnostics)) counters[name] = value;
}
