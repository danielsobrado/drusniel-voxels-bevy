import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAR_SUMMARY_GPU_CONFIG,
  farSummaryGpuConfigFromParams,
  farSummaryGpuFallbackDecision,
} from "./gpu-config.js";

describe("farSummaryGpuConfigFromParams", () => {
  it("uses defaults for missing and blank params", () => {
    const missing = farSummaryGpuConfigFromParams(new URLSearchParams());
    expect(missing).toEqual(DEFAULT_FAR_SUMMARY_GPU_CONFIG);

    const blank = farSummaryGpuConfigFromParams(new URLSearchParams(
      "farSummaryGpu=&farSummaryGpuSampleGrid= &farSummaryGpuMaxTilesPerBatch=",
    ));
    expect(blank).toEqual(DEFAULT_FAR_SUMMARY_GPU_CONFIG);
  });

  it("parses enabled flags and positive integer params", () => {
    const config = farSummaryGpuConfigFromParams(new URLSearchParams([
      ["farSummaryGpu", "1"],
      ["farSummaryGpuStrictParity", "true"],
      ["farSummaryGpuDebugReadback", "1"],
      ["farSummaryGpuCommit", "1"],
      ["farSummaryGpuSampleGrid", "32"],
      ["farSummaryGpuMaxTilesPerBatch", "64"],
      ["farSummaryGpuMaxBatchesPerFrame", "2"],
      ["farSummaryGpuMaxBufferBytes", "4096"],
      ["farSummaryGpuDebugReadbackTiles", "4"],
    ]));
    expect(config).toEqual({
      enabled: true,
      strictParity: true,
      debugReadback: true,
      commitToCache: true,
      authoritative: false,
      sampleGrid: 32,
      maxTilesPerBatch: 64,
      maxBatchesPerFrame: 2,
      maxBufferBytes: 4096,
      debugReadbackTiles: 4,
    });
  });

  it("makes authoritative mode opt-in and implies GPU enable, debug readback, and cache commit", () => {
    const config = farSummaryGpuConfigFromParams(new URLSearchParams([
      ["farSummaryGpuAuthoritative", "1"],
    ]));

    expect(config.enabled).toBe(true);
    expect(config.authoritative).toBe(true);
    expect(config.debugReadback).toBe(true);
    expect(config.commitToCache).toBe(true);
  });

  it("rejects zero for positive-only params but allows zero debug readback tiles", () => {
    const config = farSummaryGpuConfigFromParams(new URLSearchParams([
      ["farSummaryGpuSampleGrid", "0"],
      ["farSummaryGpuMaxTilesPerBatch", "0"],
      ["farSummaryGpuMaxBatchesPerFrame", "0"],
      ["farSummaryGpuMaxBufferBytes", "0"],
      ["farSummaryGpuDebugReadbackTiles", "0"],
    ]));
    expect(config.sampleGrid).toBe(DEFAULT_FAR_SUMMARY_GPU_CONFIG.sampleGrid);
    expect(config.maxTilesPerBatch).toBe(DEFAULT_FAR_SUMMARY_GPU_CONFIG.maxTilesPerBatch);
    expect(config.maxBatchesPerFrame).toBe(DEFAULT_FAR_SUMMARY_GPU_CONFIG.maxBatchesPerFrame);
    expect(config.maxBufferBytes).toBe(DEFAULT_FAR_SUMMARY_GPU_CONFIG.maxBufferBytes);
    expect(config.debugReadbackTiles).toBe(0);
  });
});

describe("farSummaryGpuFallbackDecision", () => {
  it("falls back when disabled, WebGPU is unavailable, or no tiles are dirty", () => {
    expect(farSummaryGpuFallbackDecision({ ...DEFAULT_FAR_SUMMARY_GPU_CONFIG, enabled: false }, true, 1)).toEqual({
      useGpu: false,
      reason: "disabled",
    });
    expect(farSummaryGpuFallbackDecision({ ...DEFAULT_FAR_SUMMARY_GPU_CONFIG, enabled: true }, false, 1)).toEqual({
      useGpu: false,
      reason: "webgpu_unavailable",
    });
    expect(farSummaryGpuFallbackDecision({ ...DEFAULT_FAR_SUMMARY_GPU_CONFIG, enabled: true }, true, 0)).toEqual({
      useGpu: false,
      reason: "no_dirty_tiles",
    });
  });

  it("uses GPU only when enabled, WebGPU is available, and dirty tiles exist", () => {
    expect(farSummaryGpuFallbackDecision({ ...DEFAULT_FAR_SUMMARY_GPU_CONFIG, enabled: true }, true, 1)).toEqual({
      useGpu: true,
      reason: "ready",
    });
  });
});
