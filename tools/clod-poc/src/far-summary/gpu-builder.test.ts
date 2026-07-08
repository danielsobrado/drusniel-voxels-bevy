import { describe, expect, it } from "vitest";
import type { FarSummaryGpuPlan } from "./gpu-planner.js";
import type { FarSummaryGpuConfig } from "./gpu-config.js";
import { DEFAULT_FAR_SUMMARY_GPU_CONFIG } from "./gpu-config.js";
import { createFarSummaryGpuCounters, type FarSummaryGpuCounters } from "./gpu-counters.js";
import {
  dispatchFarSummaryGpuPlanOrFallback,
  type FarSummaryGpuBuilder,
  type FarSummaryGpuDispatchResult,
} from "./gpu-builder.js";

function config(overrides: Partial<FarSummaryGpuConfig> = {}): FarSummaryGpuConfig {
  return { ...DEFAULT_FAR_SUMMARY_GPU_CONFIG, enabled: true, ...overrides };
}

function plan(tileCount = 3): FarSummaryGpuPlan {
  return {
    dirtyTiles: Array.from({ length: tileCount }, (_, index) => ({
      key: { ring: 0, x: index, z: 0, cellSizeM: 1 },
      ring: 0,
      tileX: index,
      tileZ: 0,
      cellSizeM: 1,
      tileCells: 4,
      originX: index * 4,
      originZ: 0,
      sizeX: 4,
      sizeZ: 4,
      sampleGrid: 16,
      priority: index,
      distanceToCamera: 0,
      distanceToPredictedCenter: 0,
      reason: "startup",
      revision: 1,
    })),
    batches: [],
    droppedTiles: 0,
    estimatedBufferBytes: 1234,
  };
}

class FakeBuilder implements FarSummaryGpuBuilder {
  constructor(private readonly result: FarSummaryGpuDispatchResult) {}

  async dispatch(_plan: FarSummaryGpuPlan): Promise<FarSummaryGpuDispatchResult> {
    return this.result;
  }

  dispose(): void {}
}

function successCounters(): FarSummaryGpuCounters {
  const counters = createFarSummaryGpuCounters();
  counters.enabled = 1;
  counters.deviceReady = 1;
  counters.dirtyTiles = 3;
  counters.tilesDispatched = 3;
  counters.batchesDispatched = 1;
  return counters;
}

describe("dispatchFarSummaryGpuPlanOrFallback", () => {
  it("falls back when disabled", async () => {
    const result = await dispatchFarSummaryGpuPlanOrFallback({
      plan: plan(),
      config: config({ enabled: false }),
      webGpuAvailable: true,
      builderFactory: async () => { throw new Error("must not create builder"); },
    });
    expect(result.ok).toBe(true);
    expect(result.fallbackReason).toBe("disabled");
    expect(result.fallbackTiles).toBe(3);
    expect(result.counters.fallbackTiles).toBe(3);
  });

  it("falls back when WebGPU is unavailable", async () => {
    const result = await dispatchFarSummaryGpuPlanOrFallback({
      plan: plan(),
      config: config(),
      webGpuAvailable: false,
      builderFactory: async () => null,
    });
    expect(result.fallbackReason).toBe("webgpu_unavailable");
    expect(result.fallbackTiles).toBe(3);
  });

  it("does not fallback to CPU when there are no dirty tiles", async () => {
    const result = await dispatchFarSummaryGpuPlanOrFallback({
      plan: plan(0),
      config: config(),
      webGpuAvailable: true,
      builderFactory: async () => null,
    });
    expect(result.fallbackReason).toBe("no_dirty_tiles");
    expect(result.fallbackTiles).toBe(0);
  });

  it("falls back when builder creation fails", async () => {
    const result = await dispatchFarSummaryGpuPlanOrFallback({
      plan: plan(),
      config: config(),
      webGpuAvailable: true,
      builderFactory: async () => null,
    });
    expect(result.fallbackReason).toBe("builder_unavailable");
    expect(result.fallbackTiles).toBe(3);
    expect(result.counters.bufferBytes).toBe(1234);
  });

  it("returns dispatched result without fallback on success", async () => {
    const result = await dispatchFarSummaryGpuPlanOrFallback({
      plan: plan(),
      config: config(),
      webGpuAvailable: true,
      builderFactory: async () => new FakeBuilder({ ok: true, counters: successCounters() }),
    });
    expect(result.ok).toBe(true);
    expect(result.fallbackReason).toBeNull();
    expect(result.fallbackTiles).toBe(0);
    expect(result.counters.tilesDispatched).toBe(3);
  });

  it("preserves debug readback records from successful dispatch", async () => {
    const result = await dispatchFarSummaryGpuPlanOrFallback({
      plan: plan(),
      config: config({ debugReadback: true }),
      webGpuAvailable: true,
      builderFactory: async () => new FakeBuilder({
        ok: true,
        counters: successCounters(),
        debugReadbacks: [{
          batchIndex: 0,
          records: [{
            heightMin: 1,
            heightMax: 2,
            heightAvg: 1.5,
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
            revision: 1,
            flags: 0,
            sampleCount: 16,
          }],
        }],
      }),
    });
    expect(result.fallbackReason).toBeNull();
    expect(result.debugReadbacks?.[0]?.records).toHaveLength(1);
    expect(result.debugReadbacks?.[0]?.records[0]?.heightAvg).toBe(1.5);
  });

  it("falls back all dirty tiles when dispatch fails", async () => {
    const counters = successCounters();
    const result = await dispatchFarSummaryGpuPlanOrFallback({
      plan: plan(),
      config: config(),
      webGpuAvailable: true,
      builderFactory: async () => new FakeBuilder({ ok: false, counters, error: new Error("boom") }),
    });
    expect(result.ok).toBe(false);
    expect(result.fallbackReason).toBe("dispatch_failed");
    expect(result.fallbackTiles).toBe(3);
    expect(result.counters.fallbackTiles).toBe(3);
  });
});
