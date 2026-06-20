import { describe, expect, it } from "vitest";
import {
  GRASS_GPU_RING_STORAGE_BINDINGS,
  grassGpuRingComputeUnsupportedReason,
} from "./grass_ring_compute.js";
import shaderSource from "./shaders/grass_ring.compute.wgsl?raw";

function deviceWithStorageBufferLimit(limit: number): GPUDevice {
  return {
    limits: {
      maxStorageBuffersPerShaderStage: limit,
    },
  } as unknown as GPUDevice;
}

describe("grass ring compute capabilities", () => {
  it("rejects devices below the storage-buffer count required by the compute layout", () => {
    const reason = grassGpuRingComputeUnsupportedReason(deviceWithStorageBufferLimit(6));

    expect(reason).toContain(`${GRASS_GPU_RING_STORAGE_BINDINGS} storage buffers`);
    expect(reason).toContain("device limit is 6");
  });

  it("allows devices that can bind the full compute layout", () => {
    expect(grassGpuRingComputeUnsupportedReason(
      deviceWithStorageBufferLimit(GRASS_GPU_RING_STORAGE_BINDINGS),
    )).toBeNull();
    expect(grassGpuRingComputeUnsupportedReason(deviceWithStorageBufferLimit(8))).toBeNull();
  });

  it("keeps the WGSL storage-buffer declarations within the advertised safe limit", () => {
    const storageBindings = shaderSource.match(/var<storage/g) ?? [];

    expect(storageBindings).toHaveLength(GRASS_GPU_RING_STORAGE_BINDINGS);
  });
});
