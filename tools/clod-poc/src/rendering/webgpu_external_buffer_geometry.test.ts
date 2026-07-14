import { describe, expect, it, vi } from "vitest";
import type { WebGPURenderer } from "three/webgpu";
import {
  createExternalGpuClodGeometry,
  isExternalGpuClodGeometry,
  releaseExternalGpuClodGeometry,
} from "./webgpu_external_buffer_geometry.js";
import type { GpuClodResidentPageLease } from "../terrain/streaming/gpu_clod_resident_types.js";

function fakeBuffer(): GPUBuffer {
  return { destroy: vi.fn() } as unknown as GPUBuffer;
}

describe("external WebGPU CLOD geometry", () => {
  it("binds resident buffers and disposes renderer metadata without destroying cache-owned buffers", () => {
    const backendData = new WeakMap<object, { buffer?: GPUBuffer }>();
    const renderer = {
      backend: {
        get(object: object) {
          let data = backendData.get(object);
          if (!data) {
            data = {};
            backendData.set(object, data);
          }
          return data;
        },
      },
    } as unknown as WebGPURenderer;
    const release = vi.fn();
    const vertexBuffer = fakeBuffer();
    const indexBuffer = fakeBuffer();
    const indirectBuffer = fakeBuffer();
    const lease: GpuClodResidentPageLease = {
      page: {
        id: "L0:0,0",
        revision: 1,
        level: 0,
        vertexBuffer,
        indexBuffer,
        vertexCount: 12,
        indexCount: 18,
        byteLength: 1024,
        bounds: { center: [4, 2, 4], radius: 8, minY: -1, maxY: 5 },
        meshlets: {
          headers: fakeBuffer(),
          bounds: fakeBuffer(),
          hierarchyHeaders: fakeBuffer(),
          hierarchyBounds: fakeBuffer(),
          indirect: indirectBuffer,
          meshletCount: 2,
          hierarchyNodeCount: 1,
          byteLength: 256,
        },
        errorWorld: 0,
        lowBenefit: false,
      },
      release,
    };

    const geometry = createExternalGpuClodGeometry(renderer, lease);
    const dispose = vi.fn();
    geometry.addEventListener("dispose", dispose);
    const position = geometry.getAttribute("position");
    expect(position.count).toBe(12);
    expect(geometry.index?.count).toBe(18);
    expect(geometry.drawRange.count).toBe(18);
    expect(geometry.indirectOffset).toEqual([0, 20]);
    expect(backendData.get((position as typeof position & { data: object }).data)?.buffer).toBe(vertexBuffer);
    expect(backendData.get(geometry.index as object)?.buffer).toBe(indexBuffer);
    expect(backendData.get(geometry.indirect as object)?.buffer).toBe(indirectBuffer);
    expect(isExternalGpuClodGeometry(geometry)).toBe(true);

    geometry.dispose();
    releaseExternalGpuClodGeometry(geometry);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(vertexBuffer.destroy).not.toHaveBeenCalled();
    expect(indexBuffer.destroy).not.toHaveBeenCalled();
    expect(indirectBuffer.destroy).not.toHaveBeenCalled();
    expect(isExternalGpuClodGeometry(geometry)).toBe(false);
  });
});
