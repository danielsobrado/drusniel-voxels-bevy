import { describe, expect, it } from "vitest";
import {
  DEFAULT_INFINITE_STREAMING_ROOT_GPU_MAX_INFLIGHT_BATCHES,
  DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG,
  parseStreamingRootGpuMesherConfig,
} from "./streamed_root_gpu_config.js";

describe("streamed root GPU mesher config", () => {
  it("defaults disabled with conservative batching and fallback enabled", () => {
    expect(parseStreamingRootGpuMesherConfig(new URLSearchParams())).toEqual(DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG);
  });

  it("defaults enabled with two pools for the infinite-islands scene", () => {
    const parsed = parseStreamingRootGpuMesherConfig(new URLSearchParams({ scene: "infinite-islands" }));
    expect(parsed.enabled).toBe(true);
    expect(parsed.maxInflightBatches).toBe(DEFAULT_INFINITE_STREAMING_ROOT_GPU_MAX_INFLIGHT_BATCHES);
    expect(parsed.fallback).toBe(true);
  });

  it("infinite-islands scene defaults can be opted out or reduced to one pool", () => {
    const disabled = parseStreamingRootGpuMesherConfig(
      new URLSearchParams({ scene: "infinite-islands", liveClodRootGpuMesher: "0" }),
    );
    expect(disabled.enabled).toBe(false);

    const singlePool = parseStreamingRootGpuMesherConfig(
      new URLSearchParams({ scene: "infinite-islands", liveClodRootGpuMaxInflightBatches: "1" }),
    );
    expect(singlePool.maxInflightBatches).toBe(1);
  });

  it("defaults continent to single-page GPU tile batches and keeps an explicit opt-out", () => {
    const parsed = parseStreamingRootGpuMesherConfig(new URLSearchParams({ scene: "continent" }));
    expect(parsed.enabled).toBe(true);
    expect(parsed.batchSize).toBe(1);
    expect(parsed.maxInflightBatches).toBe(DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG.maxInflightBatches);
    expect(parseStreamingRootGpuMesherConfig(new URLSearchParams({ scene: "continent", gpuTileMesh: "0" })).enabled).toBe(false);
  });

  it("parses explicit query flags", () => {
    const parsed = parseStreamingRootGpuMesherConfig(new URLSearchParams({
      liveClodRootGpuMesher: "1",
      liveClodRootGpuBatchSize: "8",
      liveClodRootGpuMaxInflightBatches: "3",
      liveClodRootGpuFallback: "0",
      liveClodRootGpuMaxChunkSlots: "32",
      liveClodRootGpuMaxSlotBytes: "123456",
      liveClodRootGpuMaxReadbackBytes: "654321",
    }));

    expect(parsed).toEqual({
      enabled: true,
      batchSize: 8,
      maxInflightBatches: 3,
      fallback: false,
      maxChunkSlots: 32,
      maxTotalSlotBytes: 123456,
      maxReadbackBufferBytes: 654321,
    });
  });

  it("ignores invalid numeric overrides without disabling fallback", () => {
    const parsed = parseStreamingRootGpuMesherConfig(new URLSearchParams({
      liveClodRootGpuMesher: "true",
      liveClodRootGpuBatchSize: "0",
      liveClodRootGpuMaxInflightBatches: "not-a-number",
      liveClodRootGpuFallback: "maybe",
      liveClodRootGpuMaxChunkSlots: "0",
      liveClodRootGpuMaxSlotBytes: "not-a-number",
      liveClodRootGpuMaxReadbackBytes: "0",
    }));

    expect(parsed).toEqual({
      enabled: true,
      batchSize: DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG.batchSize,
      maxInflightBatches: DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG.maxInflightBatches,
      fallback: true,
      maxChunkSlots: undefined,
      maxTotalSlotBytes: undefined,
      maxReadbackBufferBytes: undefined,
    });
  });
});
