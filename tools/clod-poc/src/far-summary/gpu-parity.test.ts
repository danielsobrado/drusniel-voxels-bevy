import { describe, expect, it } from "vitest";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { FarSummaryGpuConfig } from "./gpu-config.js";
import { DEFAULT_FAR_SUMMARY_GPU_CONFIG } from "./gpu-config.js";
import type { FarSummaryGpuDirtyTile, FarSummaryGpuPlan } from "./gpu-planner.js";
import type { FarSummaryGpuRecord } from "./gpu-records.js";
import { createFarSummaryGpuCounters } from "./gpu-counters.js";
import {
  applyFarSummaryGpuParityEvaluationToCounters,
  evaluateFarSummaryGpuDebugReadbackParity,
  shouldEvaluateFarSummaryGpuStrictParity,
} from "./gpu-parity.js";

function config(overrides: Partial<FarSummaryGpuConfig> = {}): FarSummaryGpuConfig {
  return {
    ...DEFAULT_FAR_SUMMARY_GPU_CONFIG,
    enabled: true,
    strictParity: true,
    debugReadback: true,
    ...overrides,
  };
}

function dirtyTile(overrides: Partial<FarSummaryGpuDirtyTile> = {}): FarSummaryGpuDirtyTile {
  return {
    key: { ring: 0, x: 0, z: 0, cellSizeM: 1 },
    ring: 0,
    tileX: 0,
    tileZ: 0,
    cellSizeM: 1,
    tileCells: 4,
    originX: 0,
    originZ: 0,
    sizeX: 4,
    sizeZ: 4,
    sampleGrid: 16,
    priority: 0,
    distanceToCamera: 0,
    distanceToPredictedCenter: 0,
    reason: "startup",
    revision: 9,
    ...overrides,
  };
}

function plan(tile = dirtyTile()): FarSummaryGpuPlan {
  return {
    dirtyTiles: [tile],
    batches: [{
      tiles: [tile],
      descriptorBytes: 64,
      outputBytes: 128,
      readbackBytes: 128,
      totalBytes: 320,
    }],
    droppedTiles: 0,
    estimatedBufferBytes: 320,
  };
}

function record(overrides: Partial<FarSummaryGpuRecord> = {}): FarSummaryGpuRecord {
  return {
    heightMin: 42,
    heightMax: 42,
    heightAvg: 42,
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
    revision: 9,
    flags: 0,
    sampleCount: 16,
    ...overrides,
  };
}

const FLAT_GRASS: FarTerrainSampler = {
  sampleHeight: () => 42,
  sampleMaterial: () => 1,
  sampleWaterCoverage: () => 0,
  sampleCanopyCoverage: () => 0,
};

describe("shouldEvaluateFarSummaryGpuStrictParity", () => {
  it("requires GPU, strict parity, and debug readback to be enabled", () => {
    expect(shouldEvaluateFarSummaryGpuStrictParity(config())).toBe(true);
    expect(shouldEvaluateFarSummaryGpuStrictParity(config({ enabled: false }))).toBe(false);
    expect(shouldEvaluateFarSummaryGpuStrictParity(config({ strictParity: false }))).toBe(false);
    expect(shouldEvaluateFarSummaryGpuStrictParity(config({ debugReadback: false }))).toBe(false);
  });
});

describe("evaluateFarSummaryGpuDebugReadbackParity", () => {
  it("skips when strict parity gates are disabled", () => {
    const result = evaluateFarSummaryGpuDebugReadbackParity({
      config: config({ strictParity: false }),
      plan: plan(),
      debugReadbacks: [{ batchIndex: 0, records: [record()] }],
      terrainSampler: FLAT_GRASS,
      frameIndex: 1,
      nowMs: 2,
    });
    expect(result).toMatchObject({
      enabled: false,
      checkedTiles: 0,
      failedTiles: 0,
      skippedReason: "strict_parity_disabled",
    });
  });

  it("skips when debug readback has no records", () => {
    const result = evaluateFarSummaryGpuDebugReadbackParity({
      config: config(),
      plan: plan(),
      debugReadbacks: [],
      terrainSampler: FLAT_GRASS,
      frameIndex: 1,
      nowMs: 2,
    });
    expect(result.skippedReason).toBe("no_debug_readbacks");
  });

  it("passes matching GPU readback against CPU reference", () => {
    const result = evaluateFarSummaryGpuDebugReadbackParity({
      config: config(),
      plan: plan(),
      debugReadbacks: [{ batchIndex: 0, records: [record()] }],
      terrainSampler: FLAT_GRASS,
      frameIndex: 1,
      nowMs: 2,
    });
    expect(result.enabled).toBe(true);
    expect(result.checkedTiles).toBe(1);
    expect(result.failedTiles).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it("reports field mismatches with tile identity", () => {
    const result = evaluateFarSummaryGpuDebugReadbackParity({
      config: config(),
      plan: plan(),
      debugReadbacks: [{ batchIndex: 0, records: [record({ heightAvg: 12 })] }],
      terrainSampler: FLAT_GRASS,
      frameIndex: 1,
      nowMs: 2,
    });
    expect(result.checkedTiles).toBe(1);
    expect(result.failedTiles).toBe(1);
    expect(result.failures[0]!.tileId).toBe("r0:0,0");
    expect(result.failures[0]!.reason).toBe("field_mismatch");
    expect(result.failures[0]!.mismatches.some((mismatch) => mismatch.field === "heightAvg")).toBe(true);
  });

  it("reports missing batch and missing tile mapping errors", () => {
    const missingBatch = evaluateFarSummaryGpuDebugReadbackParity({
      config: config(),
      plan: plan(),
      debugReadbacks: [{ batchIndex: 3, records: [record()] }],
      terrainSampler: FLAT_GRASS,
      frameIndex: 1,
      nowMs: 2,
    });
    expect(missingBatch.failedTiles).toBe(1);
    expect(missingBatch.failures[0]!.reason).toBe("missing_batch");

    const missingTile = evaluateFarSummaryGpuDebugReadbackParity({
      config: config(),
      plan: plan(),
      debugReadbacks: [{ batchIndex: 0, records: [record(), record()] }],
      terrainSampler: FLAT_GRASS,
      frameIndex: 1,
      nowMs: 2,
    });
    expect(missingTile.checkedTiles).toBe(1);
    expect(missingTile.failedTiles).toBe(1);
    expect(missingTile.failures[0]!.reason).toBe("missing_tile");
  });
});

describe("applyFarSummaryGpuParityEvaluationToCounters", () => {
  it("adds enabled parity results to GPU counters", () => {
    const counters = createFarSummaryGpuCounters();
    applyFarSummaryGpuParityEvaluationToCounters(counters, {
      enabled: true,
      checkedTiles: 3,
      failedTiles: 1,
      skippedReason: null,
      failures: [],
    });
    expect(counters.parityCheckedTiles).toBe(3);
    expect(counters.parityFailedTiles).toBe(1);
  });

  it("ignores skipped parity results", () => {
    const counters = createFarSummaryGpuCounters();
    applyFarSummaryGpuParityEvaluationToCounters(counters, {
      enabled: false,
      checkedTiles: 3,
      failedTiles: 1,
      skippedReason: "strict_parity_disabled",
      failures: [],
    });
    expect(counters.parityCheckedTiles).toBe(0);
    expect(counters.parityFailedTiles).toBe(0);
  });
});
