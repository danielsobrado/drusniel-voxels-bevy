export interface FarSummaryGpuCounters {
  enabled: number;
  deviceReady: number;
  dirtyTiles: number;
  tilesDispatched: number;
  batchesDispatched: number;
  fallbackTiles: number;
  failedBatches: number;
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
    dirtyTiles: 0,
    tilesDispatched: 0,
    batchesDispatched: 0,
    fallbackTiles: 0,
    failedBatches: 0,
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
  if (!target) return;
  target["far_summary_gpu_enabled"] = counters.enabled;
  target["far_summary_gpu_device_ready"] = counters.deviceReady;
  target["far_summary_gpu_dirty_tiles"] = counters.dirtyTiles;
  target["far_summary_gpu_tiles_dispatched"] = counters.tilesDispatched;
  target["far_summary_gpu_batches_dispatched"] = counters.batchesDispatched;
  target["far_summary_gpu_fallback_tiles"] = counters.fallbackTiles;
  target["far_summary_gpu_failed_batches"] = counters.failedBatches;
  target["far_summary_gpu_compute_ms_p50"] = counters.computeMsP50;
  target["far_summary_gpu_compute_ms_p95"] = counters.computeMsP95;
  target["far_summary_gpu_readback_ms_p95"] = counters.readbackMsP95;
  target["far_summary_gpu_parity_checked_tiles"] = counters.parityCheckedTiles;
  target["far_summary_gpu_parity_failed_tiles"] = counters.parityFailedTiles;
  target["far_summary_gpu_summary_records_live"] = counters.summaryRecordsLive;
  target["far_summary_gpu_buffer_bytes"] = counters.bufferBytes;
  target["far_summary_gpu_dropped_stale_batches"] = counters.droppedStaleBatches;
  target["far_summary_cpu_fallback_ms_p95"] = counters.cpuFallbackMsP95;
}
