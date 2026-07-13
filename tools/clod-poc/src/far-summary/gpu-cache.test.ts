import { describe, expect, it } from "vitest";
import type { FarSummaryGpuDirtyTile } from "./gpu-planner.js";
import { farSummaryGpuV2FallbackChannels, type FarSummaryGpuRecord } from "./gpu-records.js";
import { farSummaryGpuRecordToTile } from "./gpu-cache.js";

function descriptor(overrides: Partial<FarSummaryGpuDirtyTile> = {}): FarSummaryGpuDirtyTile {
  return {
    key: { ring: 1, x: 2, z: 3, cellSizeM: 8 },
    ring: 1,
    tileX: 2,
    tileZ: 3,
    cellSizeM: 8,
    tileCells: 4,
    originX: 64,
    originZ: 96,
    sizeX: 32,
    sizeZ: 32,
    sampleGrid: 16,
    priority: 0,
    distanceToCamera: 0,
    distanceToPredictedCenter: 0,
    reason: "startup",
    revision: 5,
    ...overrides,
  };
}

function record(overrides: Partial<FarSummaryGpuRecord> = {}): FarSummaryGpuRecord {
  return {
    heightMin: 10,
    heightMax: 20,
    heightAvg: 15,
    slopeMean: 0.25,
    avgNormalX: 0,
    avgNormalY: 1,
    avgNormalZ: 0,
    dominantMaterial: 2,
    materialVariance: 0.125,
    grassEligibility: 0.75,
    roughnessMean: 0.5,
    waterCoverage: 0.25,
    canopyCoverage: 0.375,
    slopeMax: 0.75,
    ...farSummaryGpuV2FallbackChannels(15),
    revision: 7,
    flags: 0,
    sampleCount: 16,
    ...overrides,
  };
}

describe("farSummaryGpuRecordToTile", () => {
  it("converts a GPU aggregate record to an existing FarSummaryTile shape", () => {
    const tile = farSummaryGpuRecordToTile({
      descriptor: descriptor(),
      record: record(),
      frameIndex: 11,
      nowMs: 22,
    });

    expect(tile.key).toEqual({ ring: 1, x: 2, z: 3, cellSizeM: 8 });
    expect(tile.state).toBe("ready");
    expect(tile.revision).toBe(7);
    expect(tile.lastTouchedFrame).toBe(11);
    expect(tile.lastTouchedTimeMs).toBe(22);
    expect(tile.originX).toBe(64);
    expect(tile.originZ).toBe(96);
    expect(tile.tileCells).toBe(4);
    expect(tile.samples).toHaveLength(16);
    expect(tile.samples[0]).toMatchObject({
      heightMin: 10,
      heightMax: 20,
      heightAvg: 15,
      normalY: 1,
      dominantMaterial: 2,
      materialVariance: 0.125,
      canopyCoverage: 0.375,
      waterCoverage: 0.25,
      waterLevel: 15,
      bodyKind: 0,
      canopyHeightAvg: 15,
      slope: 0.25,
      roughness: 0.5,
    });
  });

  it("falls back to descriptor revision when GPU record revision is zero", () => {
    const tile = farSummaryGpuRecordToTile({
      descriptor: descriptor({ revision: 9 }),
      record: record({ revision: 0 }),
      frameIndex: 1,
      nowMs: 2,
    });
    expect(tile.revision).toBe(9);
  });
});
