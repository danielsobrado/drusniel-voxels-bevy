import { describe, expect, it } from "vitest";
import type { FarSummaryTile } from "./types.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import { DEFAULT_FAR_SUMMARY_CONFIG, type FarSummaryConfig } from "./config.js";
import { DEFAULT_FAR_SUMMARY_GPU_CONFIG } from "./gpu-config.js";
import {
  FarSummaryGpuRuntime,
  type FarSummaryGpuRuntimeDispatchInput,
} from "./gpu-runtime.js";
import { createFarSummaryGpuCounters } from "./gpu-counters.js";
import { farSummaryGpuV2FallbackChannels } from "./gpu-records.js";
import type { FarSummaryGpuDispatchOrFallbackResult } from "./gpu-builder.js";

const FAR_CONFIG: FarSummaryConfig = {
  ...DEFAULT_FAR_SUMMARY_CONFIG,
  targetVisibleM: 64,
  rings: [{ name: "test", startM: 0, endM: 64, cellM: 16, tileCells: 2 }],
};

const GPU_CONFIG = {
  ...DEFAULT_FAR_SUMMARY_GPU_CONFIG,
  enabled: true,
  commitToCache: true,
  maxTilesPerBatch: 1,
  maxBatchesPerFrame: 1,
};

const TERRAIN: FarTerrainSampler = { sampleHeight: () => 0 };
const CENTER = {
  worldX: 0,
  worldZ: 0,
  predictedX: 0,
  predictedZ: 0,
  velocityX: 0,
  velocityZ: 0,
};
const DIRTY_REQUEST = {
  ring: 0,
  key: { ring: 0, x: 1, z: 2, cellSizeM: 16 },
  priority: 0,
  distanceToCamera: 0,
  distanceToPredictedCenter: 0,
};

function record(height: number) {
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
    ...farSummaryGpuV2FallbackChannels(height),
    revision: 1,
    flags: 0,
    sampleCount: 1,
  };
}

function successfulResult(): FarSummaryGpuDispatchOrFallbackResult {
  return {
    ok: true,
    counters: createFarSummaryGpuCounters(),
    fallbackTiles: 0,
    fallbackReason: null,
    cellReadbacks: [{
      batchIndex: 0,
      records: [record(10), record(11), record(12), record(13)],
    }],
  };
}

function deferredDispatch() {
  let release!: (result: FarSummaryGpuDispatchOrFallbackResult) => void;
  let input: FarSummaryGpuRuntimeDispatchInput | null = null;
  return {
    dispatch: async (next: FarSummaryGpuRuntimeDispatchInput) => {
      input = next;
      return await new Promise<FarSummaryGpuDispatchOrFallbackResult>((resolve) => {
        release = resolve;
      });
    },
    release: (result: FarSummaryGpuDispatchOrFallbackResult) => release(result),
    input: () => input,
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("FarSummaryGpuRuntime revision guards", () => {
  it("records the surface revision captured when dispatch starts", async () => {
    const committed: FarSummaryTile[] = [];
    const runtime = new FarSummaryGpuRuntime({
      gpuConfig: GPU_CONFIG,
      farSummaryConfig: FAR_CONFIG,
      terrainSampler: TERRAIN,
      surfaceRevision: () => 7,
      surfaceChangedSince: () => false,
      streamingEnabled: () => true,
      streamingGeneration: () => 0,
      commitTile: (tile) => committed.push(tile),
      dispatch: async () => successfulResult(),
    });

    runtime.update(CENTER, 1, "startup", [DIRTY_REQUEST]);
    await flushAsync();

    expect(committed).toHaveLength(1);
    expect(committed[0]!.builtAtGlobalRevision).toBe(7);
  });

  it("rejects a readback whose surface bounds changed while it was in flight", async () => {
    const committed: FarSummaryTile[] = [];
    const pending = deferredDispatch();
    let changed = false;
    const runtime = new FarSummaryGpuRuntime({
      gpuConfig: GPU_CONFIG,
      farSummaryConfig: FAR_CONFIG,
      terrainSampler: TERRAIN,
      surfaceRevision: () => 10,
      surfaceChangedSince: (_bounds, revision) => changed && revision === 10,
      streamingEnabled: () => true,
      streamingGeneration: () => 0,
      commitTile: (tile) => committed.push(tile),
      dispatch: pending.dispatch,
    });

    runtime.update(CENTER, 1, "startup", [DIRTY_REQUEST]);
    await Promise.resolve();
    expect(pending.input()).not.toBeNull();
    changed = true;
    pending.release(successfulResult());
    await flushAsync();

    expect(committed).toHaveLength(0);
    expect(runtime.stats().lastCommittedTiles).toBe(0);
  });

  it("rejects readbacks that finish after a streaming pause generation change", async () => {
    const committed: FarSummaryTile[] = [];
    const pending = deferredDispatch();
    let generation = 3;
    const runtime = new FarSummaryGpuRuntime({
      gpuConfig: GPU_CONFIG,
      farSummaryConfig: FAR_CONFIG,
      terrainSampler: TERRAIN,
      surfaceRevision: () => 0,
      surfaceChangedSince: () => false,
      streamingEnabled: () => true,
      streamingGeneration: () => generation,
      commitTile: (tile) => committed.push(tile),
      dispatch: pending.dispatch,
    });

    runtime.update(CENTER, 1, "startup", [DIRTY_REQUEST]);
    await Promise.resolve();
    generation++;
    pending.release(successfulResult());
    await flushAsync();

    expect(committed).toHaveLength(0);
    expect(runtime.stats().lastCommittedTiles).toBe(0);
  });
});
