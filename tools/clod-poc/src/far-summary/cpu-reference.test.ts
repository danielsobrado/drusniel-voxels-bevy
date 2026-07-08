import { describe, expect, it } from "vitest";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { FarSummaryGpuDirtyTile } from "./gpu-planner.js";
import {
  buildCpuFarSummaryTileReference,
  summarizeCpuFarSummaryTileReference,
} from "./cpu-reference.js";

function tile(overrides: Partial<FarSummaryGpuDirtyTile> = {}): FarSummaryGpuDirtyTile {
  return {
    key: { ring: 0, x: 2, z: 3, cellSizeM: 1 },
    ring: 0,
    tileX: 2,
    tileZ: 3,
    cellSizeM: 1,
    tileCells: 4,
    originX: 8,
    originZ: 12,
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

function buildMetrics(terrainSampler: FarTerrainSampler, descriptor = tile()) {
  const built = buildCpuFarSummaryTileReference({
    tile: descriptor,
    terrainSampler,
    frameIndex: 12,
    nowMs: 34,
  });
  return { tile: built, metrics: summarizeCpuFarSummaryTileReference(built) };
}

describe("buildCpuFarSummaryTileReference", () => {
  it("builds deterministic FarSummaryTile output from an existing GPU dirty tile descriptor", () => {
    const terrainSampler: FarTerrainSampler = { sampleHeight: () => 12 };
    const first = buildCpuFarSummaryTileReference({ tile: tile(), terrainSampler, frameIndex: 1, nowMs: 2 });
    const second = buildCpuFarSummaryTileReference({ tile: tile(), terrainSampler, frameIndex: 1, nowMs: 2 });
    expect(first).toEqual(second);
    expect(first.revision).toBe(9);
    expect(first.originX).toBe(8);
    expect(first.originZ).toBe(12);
    expect(first.tileCells).toBe(4);
    expect(first.cellSizeM).toBe(1);
    expect(first.samples).toHaveLength(16);
  });

  it("flat tile produces equal min, max, and average height", () => {
    const { metrics } = buildMetrics({ sampleHeight: () => 42 });
    expect(metrics.heightMin).toBe(42);
    expect(metrics.heightMax).toBe(42);
    expect(metrics.heightAvg).toBe(42);
    expect(metrics.avgNormalY).toBeCloseTo(1, 6);
  });

  it("water tile reports water coverage", () => {
    const { metrics } = buildMetrics({
      sampleHeight: () => 1,
      sampleWaterCoverage: () => 0.75,
    });
    expect(metrics.waterCoverage).toBeCloseTo(0.75, 6);
    expect(metrics.grassEligibility).toBeLessThan(0.3);
  });

  it("flat dry grass tile reports strong grass eligibility", () => {
    const { metrics } = buildMetrics({
      sampleHeight: () => 3,
      sampleMaterial: () => 1,
      sampleWaterCoverage: () => 0,
    });
    expect(metrics.dominantMaterial).toBe(1);
    expect(metrics.grassEligibility).toBeGreaterThan(0.95);
    expect(metrics.slopeMean).toBeCloseTo(0, 6);
  });

  it("steep rock tile rejects grass eligibility", () => {
    const { metrics } = buildMetrics({
      sampleHeight: (x) => x * 8,
      sampleMaterial: () => 2,
      sampleWaterCoverage: () => 0,
    });
    expect(metrics.dominantMaterial).toBe(2);
    expect(metrics.slopeMax).toBeGreaterThan(0.75);
    expect(metrics.grassEligibility).toBe(0);
  });

  it("mixed material tile has material variance", () => {
    const { metrics } = buildMetrics({
      sampleHeight: () => 0,
      sampleMaterial: (x) => x < 10 ? 1 : 2,
    }, tile({ key: { ring: 0, x: 0, z: 0, cellSizeM: 1 }, tileX: 0, tileZ: 0, originX: 0, originZ: 0 }));
    expect(metrics.dominantMaterial).toBe(1);
    expect(metrics.materialVariance).toBeGreaterThan(0);
    expect(metrics.materialVariance).toBeLessThanOrEqual(0.5);
  });

  it("uses sampleWaterCoverageForHeight when available", () => {
    const { metrics } = buildMetrics({
      sampleHeight: () => 4,
      sampleWaterCoverage: () => 0,
      sampleWaterCoverageForHeight: (_x, _z, height) => height >= 4 ? 1 : 0,
    });
    expect(metrics.waterCoverage).toBe(1);
  });
});
