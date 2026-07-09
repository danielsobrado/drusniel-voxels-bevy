export interface FarSummaryGpuCounters {
  enabled: number;
  deviceReady: number;
  authoritative: number;
  dirtyTiles: number;
  tilesDispatched: number;
  batchesDispatched: number;
  fallbackTiles: number;
  failedBatches: number;
  committedTiles: number;
  lastCommittedTiles: number;
  totalCommittedTiles: number;
  cpuBuildsSuppressed: number;
  runtimeError: number;
  computeMsP50: number;
  computeMsP95: number;
  readbackMsP95: number;
  parityCheckedTiles: number;
  parityFailedTiles: number;
  summaryRecordsLive: number;
  bufferBytes: number;
  droppedStaleBatches: number;
  cpuFallbackMsP95: number;
}

export function createFarSummaryGpuCounters(): FarSummaryGpuCounters {
  return {
    enabled: 0,
    deviceReady: 0,
    authoritative: 0,
    dirtyTiles: 0,
    tilesDispatched: 0,
    batchesDispatched: 0,
    fallbackTiles: 0,
    failedBatches: 0,
    committedTiles: 0,
    lastCommittedTiles: 0,
    totalCommittedTiles: 0,
    cpuBuildsSuppressed: 0,
    runtimeError: 0,
    computeMsP50: 0,
    computeMsP95: 0,
    readbackMsP95: 0,
    parityCheckedTiles: 0,
    parityFailedTiles: 0,
    summaryRecordsLive: 0,
    bufferBytes: 0,
    droppedStaleBatches: 0,
    cpuFallbackMsP95: 0,
  };
}

export function publishFarSummaryGpuCounters(
  target: Record<string, number> | undefined,
  counters: FarSummaryGpuCounters,
): void {
  const out = target ?? globalClodCounters();
  if (!out) return;
  out["far_summary_gpu_enabled"] = counters.enabled;
  out["far_summary_gpu_device_ready"] = counters.deviceReady;
  out["far_summary_gpu_authoritative"] = counters.authoritative;
  out["far_summary_gpu_dirty_tiles"] = counters.dirtyTiles;
  out["far_summary_gpu_tiles_dispatched"] = counters.tilesDispatched;
  out["far_summary_gpu_batches_dispatched"] = counters.batchesDispatched;
  out["far_summary_gpu_fallback_tiles"] = counters.fallbackTiles;
  out["far_summary_gpu_failed_batches"] = counters.failedBatches;
  out["far_summary_gpu_committed_tiles"] = counters.totalCommittedTiles;
  out["far_summary_gpu_last_committed_tiles"] = counters.lastCommittedTiles;
  out["far_summary_gpu_total_committed_tiles"] = counters.totalCommittedTiles;
  out["far_summary_cpu_builds_suppressed"] = counters.cpuBuildsSuppressed;
  out["far_summary_gpu_runtime_error"] = counters.runtimeError;
  out["far_summary_gpu_compute_ms_p50"] = counters.computeMsP50;
  out["far_summary_gpu_compute_ms_p95"] = counters.computeMsP95;
  out["far_summary_gpu_readback_ms_p95"] = counters.readbackMsP95;
  out["far_summary_gpu_parity_checked_tiles"] = counters.parityCheckedTiles;
  out["far_summary_gpu_parity_failed_tiles"] = counters.parityFailedTiles;
  out["far_summary_gpu_summary_records_live"] = counters.summaryRecordsLive;
  out["far_summary_gpu_buffer_bytes"] = counters.bufferBytes;
  out["far_summary_gpu_dropped_stale_batches"] = counters.droppedStaleBatches;
  out["far_summary_cpu_fallback_ms_p95"] = counters.cpuFallbackMsP95;
}

function globalClodCounters(): Record<string, number> | undefined {
  return (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
}
