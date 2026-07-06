import { describe, expect, it } from "vitest";
import {
  DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG,
  parseStreamingRootGpuMesherConfig,
} from "./streamed_root_gpu_config.js";

describe("streamed root GPU mesher config", () => {
  it("defaults disabled with conservative batching and fallback enabled", () => {
    expect(parseStreamingRootGpuMesherConfig(new URLSearchParams())).toEqual(DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG);
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
