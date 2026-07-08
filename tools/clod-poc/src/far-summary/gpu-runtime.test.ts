import { describe, expect, it } from "vitest";
import type { FarSummaryTile } from "./types.js";
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

function gpuRecord(height = 10) {
  return {
    heightMin: height,
    heightMax: height,
    heightAvg: height,
    slopeMean: 0,
    avgNormalX: 0,
    avgNormalY: 1,
    avgNormalZ: 0,
    dominantMaterial: 1,
    materialVariance: 0,
    grassEligibility: 1,
    roughnessMean: 0,
    waterCoverage: 0,
    canopyCoverage: 0,
    slopeMax: 0,
    revision: 3,
    flags: 0,
    sampleCount: 1,
  };
}

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

  it("commits successful per-cell GPU readbacks only when commit mode is enabled", async () => {
    const committed: FarSummaryTile[] = [];
    const runtime = new FarSummaryGpuRuntime({
      gpuConfig: { ...GPU_CONFIG, commitToCache: true },
      farSummaryConfig: FAR_CONFIG,
      terrainSampler: TERRAIN,
      nowMs: () => 456,
      commitTile: (tile) => committed.push(tile),
      dispatch: async () => ({
        ok: true,
        counters: createFarSummaryGpuCounters(),
        fallbackTiles: 0,
        fallbackReason: null,
        cellReadbacks: [{ batchIndex: 0, records: [gpuRecord(12), gpuRecord(13), gpuRecord(14), gpuRecord(15)] }],
      }),
    });

    runtime.update(CENTER, 9, "startup");
    await Promise.resolve();
    await Promise.resolve();

    expect(committed).toHaveLength(1);
    expect(committed[0]!.state).toBe("ready");
    expect(committed[0]!.lastTouchedFrame).toBe(9);
    expect(committed[0]!.lastTouchedTimeMs).toBe(456);
    expect(committed[0]!.samples.map((sample) => sample.heightAvg)).toEqual([12, 13, 14, 15]);
    expect(runtime.stats().lastCommittedTiles).toBe(1);
  });

  it("does not commit failed GPU dispatches", async () => {
    const committed: FarSummaryTile[] = [];
    const runtime = new FarSummaryGpuRuntime({
      gpuConfig: { ...GPU_CONFIG, commitToCache: true },
      farSummaryConfig: FAR_CONFIG,
      terrainSampler: TERRAIN,
      commitTile: (tile) => committed.push(tile),
      dispatch: async () => ({
        ok: false,
        counters: createFarSummaryGpuCounters(),
        fallbackTiles: 1,
        fallbackReason: "dispatch_failed",
        cellReadbacks: [{ batchIndex: 0, records: [gpuRecord(12), gpuRecord(13), gpuRecord(14), gpuRecord(15)] }],
      }),
    });

    runtime.update(CENTER, 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(committed).toHaveLength(0);
    expect(runtime.stats().lastCommittedTiles).toBe(0);
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
