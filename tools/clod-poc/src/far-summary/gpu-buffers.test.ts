import { describe, expect, it } from "vitest";
import {
  FAR_SUMMARY_GPU_DESCRIPTOR_BYTES,
  FAR_SUMMARY_GPU_DESCRIPTOR_FLAG_CANONICAL_SAMPLES,
  FAR_SUMMARY_GPU_DESCRIPTOR_FLAG_CELL_RECORDS,
  FAR_SUMMARY_GPU_RECORD_BYTES,
  type FarSummaryGpuConfig,
} from "./gpu-config.js";
import type { FarSummaryGpuDirtyTile } from "./gpu-planner.js";
import { estimateFarSummaryGpuBatchBytes } from "./gpu-planner.js";
import {
  farSummaryGpuReadbackTileCount,
  packFarSummaryCanonicalSamples,
  packFarSummaryGpuDescriptors,
} from "./gpu-buffers.js";
import { FAR_SUMMARY_LAYOUT_VERSION } from "./types.js";

function tile(overrides: Partial<FarSummaryGpuDirtyTile> = {}): FarSummaryGpuDirtyTile {
  return {
    key: { ring: 2, x: -3, z: 5, cellSizeM: 32 },
    ring: 2,
    tileX: -3,
    tileZ: 5,
    cellSizeM: 32,
    tileCells: 16,
    originX: -1536,
    originZ: 2560,
    sizeX: 512,
    sizeZ: 512,
    sampleGrid: 32,
    priority: 10,
    distanceToCamera: 1,
    distanceToPredictedCenter: 2,
    reason: "startup",
    revision: 17,
    cellRecordOffset: 123,
    ...overrides,
  };
}

const CONFIG: FarSummaryGpuConfig = {
  enabled: true,
  strictParity: false,
  debugReadback: false,
  commitToCache: false,
  authoritative: false,
  sampleGrid: 16,
  maxTilesPerBatch: 256,
  maxBatchesPerFrame: 1,
  maxBufferBytes: 16 * 1024 * 1024,
  debugReadbackTiles: 8,
};

describe("packFarSummaryGpuDescriptors", () => {
  it("packs descriptors into the shader ABI layout", () => {
    const buffer = packFarSummaryGpuDescriptors([tile()]);
    expect(buffer.byteLength).toBe(FAR_SUMMARY_GPU_DESCRIPTOR_BYTES);
    const view = new DataView(buffer);
    expect(view.getInt32(0, true)).toBe(-3);
    expect(view.getInt32(4, true)).toBe(5);
    expect(view.getUint32(8, true)).toBe(2);
    expect(view.getUint32(12, true)).toBe(32);
    expect(view.getFloat32(16, true)).toBe(-1536);
    expect(view.getFloat32(20, true)).toBe(2560);
    expect(view.getFloat32(24, true)).toBe(512);
    expect(view.getFloat32(28, true)).toBe(512);
    expect(view.getUint32(32, true)).toBe(17);
    expect(view.getUint32(36, true)).toBe(0);
    expect(view.getUint32(40, true)).toBe(16);
    expect(view.getFloat32(44, true)).toBe(32);
    expect(view.getUint32(48, true)).toBe(123);
    expect(view.getUint32(52, true)).toBe(FAR_SUMMARY_LAYOUT_VERSION);
  });

  it("sets the cell-record flag only in commit mode", () => {
    const noCommit = new DataView(packFarSummaryGpuDescriptors([tile()], { commitToCache: false }));
    const commit = new DataView(packFarSummaryGpuDescriptors([tile()], { commitToCache: true }));
    expect(noCommit.getUint32(36, true)).toBe(0);
    expect(commit.getUint32(36, true)).toBe(FAR_SUMMARY_GPU_DESCRIPTOR_FLAG_CELL_RECORDS);
  });

  it("packs canonical sample offsets and flags", () => {
    const descriptors = new DataView(packFarSummaryGpuDescriptors([
      tile({ tileCells: 2 }),
      tile({ tileCells: 3 }),
    ], { commitToCache: false }, true));
    expect(descriptors.getUint32(36, true)).toBe(FAR_SUMMARY_GPU_DESCRIPTOR_FLAG_CANONICAL_SAMPLES);
    expect(descriptors.getUint32(56, true)).toBe(0);
    expect(descriptors.getUint32(60, true)).toBe(4);
    expect(descriptors.getUint32(FAR_SUMMARY_GPU_DESCRIPTOR_BYTES + 56, true)).toBe(16);
    expect(descriptors.getUint32(FAR_SUMMARY_GPU_DESCRIPTOR_BYTES + 60, true)).toBe(5);
  });

  it("is deterministic", () => {
    const a = new Uint8Array(packFarSummaryGpuDescriptors([tile(), tile({ tileX: 9 })]));
    const b = new Uint8Array(packFarSummaryGpuDescriptors([tile(), tile({ tileX: 9 })]));
    expect([...a]).toEqual([...b]);
  });
});

describe("packFarSummaryCanonicalSamples", () => {
  it("packs a one-cell tile with its one-cell border in row-major order", () => {
    const samples = packFarSummaryCanonicalSamples([
      tile({ tileCells: 1, originX: 100, originZ: 200, cellSizeM: 10 }),
    ], {
      sampleHeight: (x, z) => x + z,
      sampleMaterial: (x, z) => x < 100 || z < 200 ? 5 : 1,
    });
    expect(samples.length).toBe(3 * 3 * 2);
    expect([...samples.slice(0, 6)]).toEqual([290, 5, 300, 5, 310, 5]);
    expect([...samples.slice(6, 10)]).toEqual([300, 5, 310, 1]);
  });
});

describe("far-summary GPU byte estimates", () => {
  it("matches descriptor and aggregate record byte constants without readback", () => {
    expect(estimateFarSummaryGpuBatchBytes(3, CONFIG)).toBe(
      3 * (FAR_SUMMARY_GPU_DESCRIPTOR_BYTES + FAR_SUMMARY_GPU_RECORD_BYTES),
    );
  });

  it("includes per-cell output and readback bytes in commit mode", () => {
    const cellRecords = 48;
    expect(estimateFarSummaryGpuBatchBytes(3, { ...CONFIG, commitToCache: true }, cellRecords)).toBe(
      3 * (FAR_SUMMARY_GPU_DESCRIPTOR_BYTES + FAR_SUMMARY_GPU_RECORD_BYTES) +
      cellRecords * FAR_SUMMARY_GPU_RECORD_BYTES * 2,
    );
  });
});

describe("farSummaryGpuReadbackTileCount", () => {
  it("uses the debug readback cap for aggregate records", () => {
    expect(farSummaryGpuReadbackTileCount(12, { ...CONFIG, debugReadback: true, debugReadbackTiles: 2 })).toBe(2);
    expect(farSummaryGpuReadbackTileCount(12, { ...CONFIG, commitToCache: true, debugReadback: false })).toBe(0);
    expect(farSummaryGpuReadbackTileCount(12, CONFIG)).toBe(0);
  });
});
