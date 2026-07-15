import { describe, expect, it, vi } from "vitest";
import terrainCandidatesSource from "./terrain_candidates.compute.wgsl?raw";
import attachmentCandidatesSource from "./attachment_candidates.compute.wgsl?raw";
import {
  createDressingCounterReset,
  DressingGpuDispatch,
  validateDressingGpuDispatchCounts,
} from "./dispatch.js";
import type { DressingGpuCapacities } from "./layouts.js";

const capacities: DressingGpuCapacities = {
  environments: 64,
  terrainCandidates: 64,
  attachmentCandidates: 32,
  visibleInstances: 96,
  drawGroups: 29,
};

describe("dressing GPU dispatch", () => {
  it("rejects dispatch counts that exceed allocated buffers", () => {
    expect(() => validateDressingGpuDispatchCounts(capacities, 65, 0)).toThrow(/environment/i);
    expect(() => validateDressingGpuDispatchCounts(capacities, 1, 33)).toThrow(/parent/i);
    expect(() => validateDressingGpuDispatchCounts(capacities, -1, 0)).toThrow(/non-negative/i);
    expect(() => validateDressingGpuDispatchCounts(capacities, 64, 32)).not.toThrow();
  });

  it("publishes exact dispatch counts through the counter reset payload", () => {
    const reset = createDressingCounterReset(17, 9);
    expect(reset).toHaveLength(64);
    expect(reset[4]).toBe(17);
    expect(reset[5]).toBe(9);
  });

  it("uses an explicit complete bind-group layout for every pipeline", () => {
    const bindGroupLayout = {} as GPUBindGroupLayout;
    const pipelineLayout = {} as GPUPipelineLayout;
    const device = {
      createBindGroupLayout: vi.fn(() => bindGroupLayout),
      createPipelineLayout: vi.fn(() => pipelineLayout),
      createShaderModule: vi.fn(() => ({})),
      createComputePipeline: vi.fn((descriptor: GPUComputePipelineDescriptor) => ({
        label: descriptor.label,
        getBindGroupLayout: () => bindGroupLayout,
      })),
    } as unknown as GPUDevice;

    new DressingGpuDispatch(device);

    expect(device.createBindGroupLayout).toHaveBeenCalledTimes(1);
    expect(device.createPipelineLayout).toHaveBeenCalledWith({
      label: "dressing pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    });
    for (const [descriptor] of vi.mocked(device.createComputePipeline).mock.calls) {
      expect(descriptor.layout).toBe(pipelineLayout);
    }
  });

  it("bounds shader reads by submitted counts and consumes the encoded class ID", () => {
    expect(terrainCandidatesSource).toContain("atomicLoad(&counters[4])");
    expect(terrainCandidatesSource).toContain("environments[id.x].reserved.x");
    expect(attachmentCandidatesSource).toContain("atomicLoad(&counters[5])");
  });
});
