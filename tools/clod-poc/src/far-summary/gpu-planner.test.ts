import { describe, expect, it } from "vitest";
import type { FarSummaryConfig } from "./config.js";
import type { StreamCenter } from "./stream-center.js";
import {
  DEFAULT_FAR_SUMMARY_GPU_CONFIG,
  FAR_SUMMARY_GPU_DESCRIPTOR_BYTES,
  FAR_SUMMARY_GPU_RECORD_BYTES,
  type FarSummaryGpuConfig,
} from "./gpu-config.js";
import {
  buildFarSummaryGpuPlan,
  estimateFarSummaryGpuBatchBytes,
  farSummaryGpuTileBounds,
  planFarSummaryGpuDirtyTiles,
  splitFarSummaryGpuBatches,
} from "./gpu-planner.js";

const SUMMARY_CONFIG: FarSummaryConfig = {
  enabled: true,
  targetVisibleM: 256,
  stream: {
    preloadSeconds: 0,
    ringCoverageMarginM: 0,
    maxTileBuildsPerFrame: 1,
    maxTileCommitsPerFrame: 8,
    maxBuildMsPerFrame: 2,
    evictionGraceSeconds: 12,
    keepStaleUntilReplacement: true,
    warmupReadyRatio: 0.95,
    warmupMaxTileBuildsPerFrame: 4,
    warmupMaxBuildMsPerFrame: 12,
  },
  rings: [
    { name: "test", startM: 0, endM: 96, cellM: 16, tileCells: 2 },
  ],
  sampling: {
    fallbackToProcedural: true,
    fallbackToLowerRing: true,
    conservativeMissingHeightM: 0,
    normalSampleStepCells: 1,
  },
  debug: {
    showClipmapGrid: false,
    showTileStates: false,
    showSummaryNormals: false,
    showRingColors: false,
  },
};

const CENTER: StreamCenter = {
  worldX: 0,
  worldZ: 0,
  predictedX: 0,
  predictedZ: 0,
  velocityX: 1,
  velocityZ: 0,
};

function gpuConfig(overrides: Partial<FarSummaryGpuConfig> = {}): FarSummaryGpuConfig {
  return { ...DEFAULT_FAR_SUMMARY_GPU_CONFIG, enabled: true, ...overrides };
}

describe("planFarSummaryGpuDirtyTiles", () => {
  it("wraps existing required far-summary tile planning into GPU descriptors", () => {
    const tiles = planFarSummaryGpuDirtyTiles(CENTER, SUMMARY_CONFIG, gpuConfig({ sampleGrid: 32 }), "startup", 7);
    expect(tiles.length).toBeGreaterThan(0);
    const first = tiles[0]!;
    expect(first).toMatchObject({
      ring: 0,
      cellSizeM: 16,
      tileCells: 2,
      sampleGrid: 32,
      reason: "startup",
      revision: 7,
    });
    expect(first.sizeX).toBe(32);
    expect(first.sizeZ).toBe(32);
  });

  it("is deterministic for the same center and revision", () => {
    const a = planFarSummaryGpuDirtyTiles(CENTER, SUMMARY_CONFIG, gpuConfig(), "camera_ring_shift", 3)
      .map((tile) => `${tile.ring}:${tile.tileX},${tile.tileZ}:${tile.priority}`);
    const b = planFarSummaryGpuDirtyTiles(CENTER, SUMMARY_CONFIG, gpuConfig(), "camera_ring_shift", 3)
      .map((tile) => `${tile.ring}:${tile.tileX},${tile.tileZ}:${tile.priority}`);
    expect(a).toEqual(b);
  });

  it("reports tile bounds consistently with descriptor origin and size", () => {
    const tiles = planFarSummaryGpuDirtyTiles(CENTER, SUMMARY_CONFIG, gpuConfig(), "startup", 1);
    expect(tiles.length).toBeGreaterThan(0);
    const tile = tiles[0]!;
    const bounds = farSummaryGpuTileBounds(tile);
    expect(bounds.minX).toBe(tile.originX);
    expect(bounds.minZ).toBe(tile.originZ);
    expect(bounds.maxX).toBe(tile.originX + tile.sizeX);
    expect(bounds.maxZ).toBe(tile.originZ + tile.sizeZ);
  });
});

describe("splitFarSummaryGpuBatches", () => {
  it("respects max tile count and max batches per frame", () => {
    const tiles = planFarSummaryGpuDirtyTiles(CENTER, SUMMARY_CONFIG, gpuConfig(), "startup", 1);
    const batches = splitFarSummaryGpuBatches(tiles, gpuConfig({ maxTilesPerBatch: 3, maxBatchesPerFrame: 2 }));
    expect(batches).toHaveLength(2);
    expect(batches.every((batch) => batch.tiles.length <= 3)).toBe(true);
    expect(batches.reduce((sum, batch) => sum + batch.tiles.length, 0)).toBe(6);
  });

  it("respects buffer byte caps", () => {
    const tiles = planFarSummaryGpuDirtyTiles(CENTER, SUMMARY_CONFIG, gpuConfig(), "startup", 1);
    const maxBufferBytes = 2 * (FAR_SUMMARY_GPU_DESCRIPTOR_BYTES + FAR_SUMMARY_GPU_RECORD_BYTES);
    const batches = splitFarSummaryGpuBatches(tiles, gpuConfig({ maxTilesPerBatch: 16, maxBatchesPerFrame: 3, maxBufferBytes }));
    expect(batches.length).toBeGreaterThan(0);
    expect(batches.every((batch) => batch.tiles.length <= 2)).toBe(true);
    expect(batches.every((batch) => batch.totalBytes <= maxBufferBytes)).toBe(true);
  });

  it("drops oversized single tiles instead of creating invalid batches", () => {
    const tiles = planFarSummaryGpuDirtyTiles(CENTER, SUMMARY_CONFIG, gpuConfig(), "startup", 1);
    const batches = splitFarSummaryGpuBatches(tiles, gpuConfig({ maxBufferBytes: FAR_SUMMARY_GPU_DESCRIPTOR_BYTES - 1 }));
    expect(batches).toEqual([]);
  });
});

describe("buildFarSummaryGpuPlan", () => {
  it("reports dropped tiles and peak batch buffer estimate", () => {
    const plan = buildFarSummaryGpuPlan(CENTER, SUMMARY_CONFIG, gpuConfig({ maxTilesPerBatch: 2, maxBatchesPerFrame: 1 }), "startup", 1);
    expect(plan.dirtyTiles.length).toBeGreaterThan(2);
    expect(plan.batches).toHaveLength(1);
    const firstBatch = plan.batches[0]!;
    expect(firstBatch.tiles).toHaveLength(2);
    expect(plan.droppedTiles).toBe(plan.dirtyTiles.length - 2);
    expect(plan.estimatedBufferBytes).toBe(firstBatch.totalBytes);
  });
});

describe("estimateFarSummaryGpuBatchBytes", () => {
  it("includes optional debug readback bytes only when enabled", () => {
    const perfBytes = estimateFarSummaryGpuBatchBytes(4, gpuConfig({ debugReadback: false, debugReadbackTiles: 4 }));
    const debugBytes = estimateFarSummaryGpuBatchBytes(4, gpuConfig({ debugReadback: true, debugReadbackTiles: 2 }));
    expect(perfBytes).toBe(4 * (FAR_SUMMARY_GPU_DESCRIPTOR_BYTES + FAR_SUMMARY_GPU_RECORD_BYTES));
    expect(debugBytes).toBe(perfBytes + 2 * FAR_SUMMARY_GPU_RECORD_BYTES);
  });
});
