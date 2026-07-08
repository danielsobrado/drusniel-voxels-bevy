import { describe, expect, it } from "vitest";
import {
  FAR_SUMMARY_GPU_DESCRIPTOR_BYTES,
  FAR_SUMMARY_GPU_RECORD_BYTES,
  type FarSummaryGpuConfig,
} from "./gpu-config.js";
import type { FarSummaryGpuDirtyTile } from "./gpu-planner.js";
import { estimateFarSummaryGpuBatchBytes } from "./gpu-planner.js";
import { farSummaryGpuReadbackTileCount, packFarSummaryGpuDescriptors } from "./gpu-buffers.js";

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
    ...overrides,
  };
}

const CONFIG: FarSummaryGpuConfig = {
  enabled: true,
  strictParity: false,
  debugReadback: false,
  commitToCache: false,
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
  });

  it("is deterministic", () => {
    const a = new Uint8Array(packFarSummaryGpuDescriptors([tile(), tile({ tileX: 9 })]));
    const b = new Uint8Array(packFarSummaryGpuDescriptors([tile(), tile({ tileX: 9 })]));
    expect([...a]).toEqual([...b]);
  });
});

describe("far-summary GPU byte estimates", () => {
  it("matches descriptor and record byte constants", () => {
    expect(estimateFarSummaryGpuBatchBytes(3, CONFIG)).toBe(
      3 * (FAR_SUMMARY_GPU_DESCRIPTOR_BYTES + FAR_SUMMARY_GPU_RECORD_BYTES),
    );
  });
});

describe("farSummaryGpuReadbackTileCount", () => {
  it("reads back all tiles in commit mode", () => {
    expect(farSummaryGpuReadbackTileCount(12, { ...CONFIG, commitToCache: true, debugReadbackTiles: 2 })).toBe(12);
  });

  it("uses the debug readback cap outside commit mode", () => {
    expect(farSummaryGpuReadbackTileCount(12, { ...CONFIG, debugReadback: true, debugReadbackTiles: 2 })).toBe(2);
    expect(farSummaryGpuReadbackTileCount(12, CONFIG)).toBe(0);
  });
});
