import { afterEach, describe, expect, it } from "vitest";
import { createFarSummaryGpuCounters, publishFarSummaryGpuCounters } from "./gpu-counters.js";

const originalWindow = globalThis.window;

function setWindowForTest(value: unknown): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value,
  });
}

function filledCounters() {
  const counters = createFarSummaryGpuCounters();
  counters.enabled = 1;
  counters.deviceReady = 1;
  counters.dirtyTiles = 3;
  counters.tilesDispatched = 2;
  counters.batchesDispatched = 1;
  counters.fallbackTiles = 4;
  counters.failedBatches = 5;
  counters.computeMsP50 = 6;
  counters.computeMsP95 = 7;
  counters.readbackMsP95 = 8;
  counters.parityCheckedTiles = 9;
  counters.parityFailedTiles = 10;
  counters.summaryRecordsLive = 11;
  counters.bufferBytes = 12;
  counters.droppedStaleBatches = 13;
  counters.cpuFallbackMsP95 = 14;
  return counters;
}

function expectedCounters() {
  return {
    far_summary_gpu_enabled: 1,
    far_summary_gpu_device_ready: 1,
    far_summary_gpu_dirty_tiles: 3,
    far_summary_gpu_tiles_dispatched: 2,
    far_summary_gpu_batches_dispatched: 1,
    far_summary_gpu_fallback_tiles: 4,
    far_summary_gpu_failed_batches: 5,
    far_summary_gpu_compute_ms_p50: 6,
    far_summary_gpu_compute_ms_p95: 7,
    far_summary_gpu_readback_ms_p95: 8,
    far_summary_gpu_parity_checked_tiles: 9,
    far_summary_gpu_parity_failed_tiles: 10,
    far_summary_gpu_summary_records_live: 11,
    far_summary_gpu_buffer_bytes: 12,
    far_summary_gpu_dropped_stale_batches: 13,
    far_summary_cpu_fallback_ms_p95: 14,
  };
}

describe("publishFarSummaryGpuCounters", () => {
  afterEach(() => {
    setWindowForTest(originalWindow);
  });

  it("publishes the acceptance-visible snake_case counter names", () => {
    const target: Record<string, number> = {};
    publishFarSummaryGpuCounters(target, filledCounters());
    expect(target).toEqual(expectedCounters());
  });

  it("publishes to global CLOD counters when target is omitted", () => {
    const counters: Record<string, number> = {};
    setWindowForTest({ __drusnielClod: { stats: { counters } } });
    publishFarSummaryGpuCounters(undefined, filledCounters());
    expect(counters).toEqual(expectedCounters());
  });

  it("does nothing without a target or global counters", () => {
    setWindowForTest(undefined);
    expect(() => publishFarSummaryGpuCounters(undefined, createFarSummaryGpuCounters())).not.toThrow();
  });
});
