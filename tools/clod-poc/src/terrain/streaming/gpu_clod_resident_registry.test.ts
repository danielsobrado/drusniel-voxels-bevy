import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireGpuClodResidentPage,
  clearGpuClodResidentPages,
  registerGpuClodResidentPage,
  retireGpuClodResidentPage,
} from "./gpu_clod_resident_registry.js";
import type { GpuClodResidentPage } from "./gpu_clod_resident_types.js";

function buffer(): GPUBuffer {
  return { destroy: vi.fn() } as unknown as GPUBuffer;
}

function page(id = "L0:0,0"): GpuClodResidentPage {
  return {
    id,
    revision: 1,
    level: 0,
    vertexBuffer: buffer(),
    indexBuffer: buffer(),
    vertexCount: 3,
    indexCount: 3,
    byteLength: 256,
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 0 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

afterEach(() => clearGpuClodResidentPages());

describe("GPU CLOD resident registry", () => {
  it("releases first-view protection exactly once", () => {
    const residentPage = page();
    const onFirstAcquire = vi.fn();
    registerGpuClodResidentPage(residentPage, onFirstAcquire);

    const first = acquireGpuClodResidentPage(residentPage.id, residentPage.revision);
    const second = acquireGpuClodResidentPage(residentPage.id, residentPage.revision);
    expect(first?.page).toBe(residentPage);
    expect(second?.page).toBe(residentPage);
    expect(onFirstAcquire).toHaveBeenCalledTimes(1);

    first?.release();
    second?.release();
  });

  it("keeps retired buffers alive until the final render lease releases", () => {
    const residentPage = page();
    registerGpuClodResidentPage(residentPage);
    const lease = acquireGpuClodResidentPage(residentPage.id, residentPage.revision);
    expect(lease).not.toBeNull();

    retireGpuClodResidentPage(residentPage.id, residentPage);
    expect(residentPage.vertexBuffer.destroy).not.toHaveBeenCalled();
    expect(residentPage.indexBuffer.destroy).not.toHaveBeenCalled();
    expect(acquireGpuClodResidentPage(residentPage.id)).toBeNull();

    lease?.release();
    expect(residentPage.vertexBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(residentPage.indexBuffer.destroy).toHaveBeenCalledTimes(1);
  });
});
