import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GPU_CLOD_HIERARCHY_CONFIG } from "./gpu_clod_hierarchy_config.js";

const BUFFER_USAGE = {
  MAP_READ: 1,
  COPY_SRC: 2,
  COPY_DST: 4,
  INDEX: 8,
  VERTEX: 16,
  UNIFORM: 32,
  STORAGE: 64,
  INDIRECT: 128,
} as const;

function restoreGlobal(name: "GPUBufferUsage" | "GPUShaderStage", descriptor?: PropertyDescriptor): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete (globalThis as unknown as Record<string, unknown>)[name];
}

describe("GPU CLOD page pipeline layouts", () => {
  it("shares explicit layouts across paired compute stages", async () => {
    const previousBufferUsage = Object.getOwnPropertyDescriptor(globalThis, "GPUBufferUsage");
    const previousShaderStage = Object.getOwnPropertyDescriptor(globalThis, "GPUShaderStage");
    Object.defineProperty(globalThis, "GPUBufferUsage", { configurable: true, value: BUFFER_USAGE });
    Object.defineProperty(globalThis, "GPUShaderStage", {
      configurable: true,
      value: { COMPUTE: 4 },
    });

    const descriptors: GPUComputePipelineDescriptor[] = [];
    const device = {
      createShaderModule: vi.fn(() => ({} as GPUShaderModule)),
      createBindGroupLayout: vi.fn((descriptor: GPUBindGroupLayoutDescriptor) => (
        { descriptor } as unknown as GPUBindGroupLayout
      )),
      createPipelineLayout: vi.fn((descriptor: GPUPipelineLayoutDescriptor) => (
        { descriptor } as unknown as GPUPipelineLayout
      )),
      createComputePipelineAsync: vi.fn(async (descriptor: GPUComputePipelineDescriptor) => {
        descriptors.push(descriptor);
        return { getBindGroupLayout: vi.fn() } as unknown as GPUComputePipeline;
      }),
    } as unknown as GPUDevice;

    try {
      const { GpuClodPagePipeline } = await import("./gpu_clod_page_pipeline.js");
      await GpuClodPagePipeline.create(device, {
        fieldParams: {} as GPUBuffer,
        config: DEFAULT_GPU_CLOD_HIERARCHY_CONFIG,
        weldEpsilon: 0.001,
        normalDotMin: 0.999,
        materialEpsilon: 0.001,
        terrainMinY: 0,
        terrainMaxY: 64,
      });

      const layoutFor = (label: string) => descriptors.find((descriptor) => descriptor.label === label)?.layout;
      const packLayout = layoutFor("gpu clod pack vertices");
      const reductionLayout = layoutFor("gpu clod weld vertices");

      expect(packLayout).not.toBe("auto");
      expect(layoutFor("gpu clod pack indices")).toBe(packLayout);
      expect(reductionLayout).not.toBe("auto");
      expect(layoutFor("gpu clod weld indices")).toBe(reductionLayout);
      expect(layoutFor("gpu clod simplify vertices")).toBe(reductionLayout);
      expect(layoutFor("gpu clod simplify indices")).toBe(reductionLayout);
      expect(layoutFor("gpu clod offset indices")).toBe("auto");
      expect(layoutFor("gpu clod build meshlets")).toBe("auto");
      expect(layoutFor("gpu clod build meshlet hierarchy")).toBe("auto");
    } finally {
      restoreGlobal("GPUBufferUsage", previousBufferUsage);
      restoreGlobal("GPUShaderStage", previousShaderStage);
    }
  });
});
