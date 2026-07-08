import { describe, expect, it } from "vitest";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { FarSummaryConfig } from "./config.js";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import type { FarSummaryGpuConfig } from "./gpu-config.js";
import { DEFAULT_FAR_SUMMARY_GPU_CONFIG } from "./gpu-config.js";
import type { FarSummaryGpuRuntimeDispatchInput } from "./gpu-runtime.js";
import { FarSummaryGpuRuntime } from "./gpu-runtime.js";
import { createFarSummaryGpuCounters } from "./gpu-counters.js";

const FAR_CONFIG: FarSummaryConfig = {
  ...DEFAULT_FAR_SUMMARY_CONFIG,
  targetVisibleM: 64,
  rings: [{ name: "test", startM: 0, endM: 64, cellM: 16, tileCells: 2 }],
};

const GPU_CONFIG: FarSummaryGpuConfig = {
  ...DEFAULT_FAR_SUMMARY_GPU_CONFIG,
  enabled: true,
  maxTilesPerBatch: 2,
  maxBatchesPerFrame: 1,
};

const TERRAIN: FarTerrainSampler = {
  sampleHeight: () => 0,
};

const CENTER = {
  worldX: 0,
  worldZ: 0,
  predictedX: 0,
  predictedZ: 0,
  velocityX: 0,
  velocityZ: 0,
};

describe("FarSummaryGpuRuntime", () => {
  it("does nothing when disabled", async () => {
    let dispatches = 0;
    const runtime = new FarSummaryGpuRuntime({
      gpuConfig: { ...GPU_CONFIG, enabled: false },
      farSummaryConfig: FAR_CONFIG,
      terrainSampler: TERRAIN,
      dispatch: async () => {
        dispatches++;
        return { ok: true, counters: createFarSummaryGpuCounters(), fallbackTiles: 0, fallbackReason: null };
      },
    });

    runtime.update(CENTER, 1);
    await Promise.resolve();
    expect(dispatches).toBe(0);
    expect(runtime.stats().scheduledFrames).toBe(0);
  });

  it("schedules one async GPU plan and records fallback result", async () => {
    let inputSeen: FarSummaryGpuRuntimeDispatchInput | null = null;
    const runtime = new FarSummaryGpuRuntime({
      gpuConfig: GPU_CONFIG,
      farSummaryConfig: FAR_CONFIG,
      terrainSampler: TERRAIN,
      webGpuAvailable: () => false,
      nowMs: () => 123,
      dispatch: async (input) => {
        inputSeen = input;
        return { ok: true, counters: createFarSummaryGpuCounters(), fallbackTiles: input.plan.dirtyTiles.length, fallbackReason: "webgpu_unavailable" };
      },
    });

    runtime.update(CENTER, 7, "startup");
    await Promise.resolve();
    await Promise.resolve();

    expect(inputSeen).not.toBeNull();
    expect(inputSeen!.frameIndex).toBe(7);
    expect(inputSeen!.nowMs).toBe(123);
    expect(inputSeen!.terrainSampler).toBe(TERRAIN);
    expect(runtime.stats().scheduledFrames).toBe(1);
    expect(runtime.stats().lastFallbackReason).toBe("webgpu_unavailable");
    expect(runtime.stats().lastFallbackTiles).toBeGreaterThan(0);
  });

  it("skips new frames while a dispatch is inflight", async () => {
    let release!: () => void;
    const runtime = new FarSummaryGpuRuntime({
      gpuConfig: GPU_CONFIG,
      farSummaryConfig: FAR_CONFIG,
      terrainSampler: TERRAIN,
      dispatch: async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        return { ok: true, counters: createFarSummaryGpuCounters(), fallbackTiles: 0, fallbackReason: null };
      },
    });

    runtime.update(CENTER, 1);
    runtime.update(CENTER, 2);
    expect(runtime.stats().scheduledFrames).toBe(1);
    expect(runtime.stats().skippedInflightFrames).toBe(1);
    release();
    await Promise.resolve();
  });

  it("captures dispatch errors without throwing on the frame path", async () => {
    const runtime = new FarSummaryGpuRuntime({
      gpuConfig: GPU_CONFIG,
      farSummaryConfig: FAR_CONFIG,
      terrainSampler: TERRAIN,
      dispatch: async () => { throw new Error("boom"); },
    });

    runtime.update(CENTER, 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.stats().lastError).toBe("boom");
  });
});
