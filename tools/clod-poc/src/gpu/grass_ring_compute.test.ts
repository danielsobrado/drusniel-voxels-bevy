import { describe, expect, it } from "vitest";
import {
  GRASS_GPU_RING_STORAGE_BINDINGS,
  grassGpuRingOutputIndex,
  grassGpuRingTierRegion,
  grassGpuRingComputeUnsupportedReason,
} from "./grass_ring_compute.js";
import fieldShaderSource from "./shaders/terrain_field.wgsl?raw";
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
    const storageBindings = `${fieldShaderSource}\n${shaderSource}`.match(/var<storage/g) ?? [];

    expect(storageBindings).toHaveLength(GRASS_GPU_RING_STORAGE_BINDINGS);
  });

  it("dispatches one cull kernel over the slot grid", () => {
    expect(shaderSource).toContain("fn grass_cull(");
    expect(shaderSource).not.toContain("fn grass_cull_fine(");
    expect(shaderSource).not.toContain("fn grass_cull_far(");
  });

  it("keeps tier compact regions aligned with indirect firstInstance", () => {
    const maxPerTier = 1024;

    for (let tier = 0; tier < 4; tier++) {
      const region = grassGpuRingTierRegion(tier, maxPerTier);
      expect(region.start).toBe(tier * maxPerTier);
      expect(region.end).toBe((tier + 1) * maxPerTier);
      expect(region.firstInstance).toBe(region.start);
      expect(grassGpuRingOutputIndex(tier, 17, maxPerTier)).toBe(region.firstInstance + 17);
    }
  });
});
