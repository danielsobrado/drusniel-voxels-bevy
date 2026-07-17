import { describe, expect, it } from "vitest";
import {
  DEEP_WINDOW_RETRY_VY_BASE,
  RootGpuBatchLimitError,
  chunkSlotsPerRootPage,
  deepWindowRetryPlans,
  estimateChunkSlotBytes,
  estimateRootRequestReadbackBytes,
  findChunkVerticesOutOfBounds,
  fullyEmptyLod0PageKeys,
  planGeometryReadbackLayout,
  planRootBatchChunkSlots,
  splitRootGpuBatches,
} from "./gpu_clod_root_batch_buffers.js";

const CFG = {
  chunks_per_page: 2,
  chunk_size: 8,
  quadtree_levels: 3,
};

describe("findChunkVerticesOutOfBounds", () => {
  // Chunk cell box [128,192]x[1536,1600] with a 2-cell halo -> allowed [126,194]x[1534,1602].
  const minX = 126, maxX = 194, minZ = 1534, maxZ = 1602;

  it("passes a chunk whose vertices sit inside its cell box (plus halo)", () => {
    const positions = new Float32Array([
      128.5, 40, 1536.5,
      191.5, 41, 1599.5,
      126.0, 42, 1602.0, // exactly on the halo edge
    ]);
    expect(findChunkVerticesOutOfBounds(positions, 3, minX, maxX, minZ, maxZ)).toBeNull();
  });

  it("flags a stale/garbage vertex far outside the chunk box", () => {
    const positions = new Float32Array([
      128.5, 40, 1536.5,
      261.09, 8.99, 1285.94, // the reported mislocated vertex (~4 pages away in z)
      191.5, 41, 1599.5,
    ]);
    const violation = findChunkVerticesOutOfBounds(positions, 3, minX, maxX, minZ, maxZ);
    expect(violation).not.toBeNull();
    expect(violation!.outCount).toBe(1);
    expect(violation!.firstIndex).toBe(1);
    expect(violation!.x).toBeCloseTo(261.09, 2);
    expect(violation!.z).toBeCloseTo(1285.94, 2);
  });
});

describe("streamed root batch planning", () => {
  it("plans one L0 root as one page worth of chunk slots", () => {
    const slots = planRootBatchChunkSlots([{ px: 3, pz: 4, level: 0 }], CFG);

    expect(slots).toHaveLength(4);
    expect(slots.map((slot) => [slot.cx, slot.cz])).toEqual([
      [6, 8],
      [7, 8],
      [6, 9],
      [7, 9],
    ]);
    expect(slots.every((slot) => slot.requestIndex === 0 && slot.rootLevel === 0)).toBe(true);
  });

  it("plans one L1 root as four L0 pages worth of chunk slots", () => {
    const slots = planRootBatchChunkSlots([{ px: 1, pz: 2, level: 1 }], CFG);

    expect(slots).toHaveLength(chunkSlotsPerRootPage(CFG.chunks_per_page, 1));
    expect(slots).toHaveLength(16);
    expect(new Set(slots.map((slot) => `${slot.lod0Px},${slot.lod0Pz}`))).toEqual(new Set([
      "2,4",
      "3,4",
      "2,5",
      "3,5",
    ]));
  });

  it("splits on chunk-slot caps", () => {
    const requests = [
      { px: 0, pz: 0, level: 1 },
      { px: 1, pz: 0, level: 1 },
      { px: 2, pz: 0, level: 0 },
    ];
    const batches = splitRootGpuBatches(requests, CFG, {
      batchSize: 4,
      maxChunkSlots: 20,
      maxTotalSlotBytes: Number.MAX_SAFE_INTEGER,
    });

    expect(batches.map((batch) => batch.length)).toEqual([1, 2]);
  });

  it("throws instead of accepting a single chunk-slot oversized request", () => {
    expect(() => splitRootGpuBatches([{ px: 0, pz: 0, level: 1 }], CFG, {
      batchSize: 4,
      maxChunkSlots: 8,
      maxTotalSlotBytes: Number.MAX_SAFE_INTEGER,
    })).toThrow(RootGpuBatchLimitError);
  });

  it("splits on total byte caps", () => {
    const estimate = estimateChunkSlotBytes(CFG.chunk_size);
    const requests = [
      { px: 0, pz: 0, level: 0 },
      { px: 1, pz: 0, level: 0 },
    ];
    const batches = splitRootGpuBatches(requests, CFG, {
      batchSize: 8,
      maxChunkSlots: 64,
      maxTotalSlotBytes: estimate.totalBytes * 4,
    });

    expect(batches.map((batch) => batch.length)).toEqual([1, 1]);
  });

  it("splits on grouped readback byte caps", () => {
    const readbackBytes = estimateRootRequestReadbackBytes({ px: 0, pz: 0, level: 0 }, CFG);
    const requests = [
      { px: 0, pz: 0, level: 0 },
      { px: 1, pz: 0, level: 0 },
    ];
    const batches = splitRootGpuBatches(requests, CFG, {
      batchSize: 8,
      maxChunkSlots: 64,
      maxTotalSlotBytes: Number.MAX_SAFE_INTEGER,
      maxReadbackBufferBytes: readbackBytes,
    });

    expect(batches.map((batch) => batch.length)).toEqual([1, 1]);
  });

  it("throws instead of accepting a single readback-oversized request", () => {
    const readbackBytes = estimateRootRequestReadbackBytes({ px: 0, pz: 0, level: 0 }, CFG);

    expect(() => splitRootGpuBatches([{ px: 0, pz: 0, level: 0 }], CFG, {
      batchSize: 4,
      maxChunkSlots: 64,
      maxTotalSlotBytes: Number.MAX_SAFE_INTEGER,
      maxReadbackBufferBytes: readbackBytes - 1,
    })).toThrow(RootGpuBatchLimitError);
  });
});

describe("deep-window retry for fully submerged pages", () => {
  function meshWithIndices(count: number): { indices: { length: number } } {
    return { indices: { length: count } };
  }

  it("identifies only pages whose every chunk meshed empty", () => {
    const plans = planRootBatchChunkSlots([
      { px: -126, pz: 0, level: 0 },
      { px: 0, pz: 0, level: 0 },
    ], CFG);
    const meshes = new Map(plans.map((plan) => [
      plan.slotIndex,
      meshWithIndices(plan.rootPx === -126 ? 0 : 3),
    ]));
    const empty = fullyEmptyLod0PageKeys(plans, meshes);
    expect(empty).toEqual(new Set(["-126,0"]));
  });

  it("does not flag a page with one non-empty chunk", () => {
    const plans = planRootBatchChunkSlots([{ px: 5, pz: 5, level: 0 }], CFG);
    const meshes = new Map(plans.map((plan) => [plan.slotIndex, meshWithIndices(plan.localChunkIndex === 0 ? 3 : 0)]));
    expect(fullyEmptyLod0PageKeys(plans, meshes).size).toBe(0);
  });

  it("rebases retry plans to fresh slot indices with the lowered window", () => {
    const plans = planRootBatchChunkSlots([
      { px: -126, pz: 0, level: 0 },
      { px: 0, pz: 0, level: 0 },
    ], CFG);
    const retry = deepWindowRetryPlans(plans, new Set(["-126,0"]));
    expect(retry).toHaveLength(CFG.chunks_per_page * CFG.chunks_per_page);
    expect(retry.map((plan) => plan.slotIndex)).toEqual([0, 1, 2, 3]);
    expect(retry.every((plan) => plan.vyBase === DEEP_WINDOW_RETRY_VY_BASE)).toBe(true);
    expect(retry.every((plan) => plan.rootPx === -126)).toBe(true);
    expect(DEEP_WINDOW_RETRY_VY_BASE).toBe(-64);
  });
});

describe("streamed root grouped readback layout", () => {
  it("packs live geometry ranges without overlap", () => {
    const layout = planGeometryReadbackLayout([
      { slotIndex: 0, vertexCount: 3, indexCount: 6 },
      { slotIndex: 1, vertexCount: 0, indexCount: 0 },
      { slotIndex: 2, vertexCount: 2, indexCount: 3 },
    ]);

    expect(layout.ranges[0]).toMatchObject({
      positionsOffset: 0,
      positionsBytes: 36,
      normalsOffset: 0,
      normalsBytes: 36,
      materialsOffset: 0,
      materialsBytes: 12,
      indicesOffset: 0,
      indicesBytes: 24,
    });
    expect(layout.ranges[1]).toMatchObject({
      positionsOffset: 36,
      positionsBytes: 0,
      indicesOffset: 24,
      indicesBytes: 0,
    });
    expect(layout.ranges[2]).toMatchObject({
      positionsOffset: 36,
      positionsBytes: 24,
      materialsOffset: 12,
      materialsBytes: 8,
      indicesOffset: 24,
      indicesBytes: 12,
    });
    expect(layout.positionsBytes).toBe(60);
    expect(layout.normalsBytes).toBe(60);
    expect(layout.materialsBytes).toBe(20);
    expect(layout.indicesBytes).toBe(36);
  });
});
