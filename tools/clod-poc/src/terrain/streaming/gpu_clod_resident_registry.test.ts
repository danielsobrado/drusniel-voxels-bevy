import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireGpuClodResidentPage,
  clearGpuClodResidentPages,
  isGpuClodResidentPageLeased,
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
    expect(isGpuClodResidentPageLeased(residentPage.id, residentPage)).toBe(true);

    first?.release();
    expect(isGpuClodResidentPageLeased(residentPage.id, residentPage)).toBe(true);
    second?.release();
    expect(isGpuClodResidentPageLeased(residentPage.id, residentPage)).toBe(false);
  });

  it("rolls back and retries a failed first acquisition", () => {
    const residentPage = page();
    const onFirstAcquire = vi.fn()
      .mockImplementationOnce(() => { throw new Error("first view failed"); })
      .mockImplementationOnce(() => undefined);
    registerGpuClodResidentPage(residentPage, onFirstAcquire);

    expect(() => acquireGpuClodResidentPage(residentPage.id)).toThrow("first view failed");
    expect(isGpuClodResidentPageLeased(residentPage.id, residentPage)).toBe(false);

    const lease = acquireGpuClodResidentPage(residentPage.id);
    expect(lease).not.toBeNull();
    expect(onFirstAcquire).toHaveBeenCalledTimes(2);
    lease?.release();
  });

  it("notifies every transition from leased to unleased", () => {
    const residentPage = page();
    const onFinalRelease = vi.fn();
    registerGpuClodResidentPage(residentPage, undefined, onFinalRelease);

    acquireGpuClodResidentPage(residentPage.id)?.release();
    acquireGpuClodResidentPage(residentPage.id)?.release();

    expect(onFinalRelease).toHaveBeenCalledTimes(2);
  });

  it("keeps retired buffers alive until the final render lease releases", () => {
    const residentPage = page();
    const onDestroyed = vi.fn();
    registerGpuClodResidentPage(residentPage, undefined, undefined, onDestroyed);
    const lease = acquireGpuClodResidentPage(residentPage.id, residentPage.revision);
    expect(lease).not.toBeNull();

    retireGpuClodResidentPage(residentPage.id, residentPage);
    expect(residentPage.vertexBuffer.destroy).not.toHaveBeenCalled();
    expect(residentPage.indexBuffer.destroy).not.toHaveBeenCalled();
    expect(onDestroyed).not.toHaveBeenCalled();
    expect(acquireGpuClodResidentPage(residentPage.id)).toBeNull();

    lease?.release();
    expect(residentPage.vertexBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(residentPage.indexBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(onDestroyed).toHaveBeenCalledTimes(1);
  });
});
