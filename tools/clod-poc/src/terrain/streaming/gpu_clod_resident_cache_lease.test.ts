import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GPU_CLOD_HIERARCHY_CONFIG } from "./gpu_clod_hierarchy_config.js";
import { GpuClodResidentPageCache } from "./gpu_clod_resident_page_cache.js";
import {
  acquireGpuClodResidentPage,
  clearGpuClodResidentPages,
} from "./gpu_clod_resident_registry.js";
import type { GpuClodResidentPage } from "./gpu_clod_resident_types.js";

function page(id: string, byteLength: number): GpuClodResidentPage {
  return {
    id,
    revision: 1,
    level: 0,
    vertexBuffer: { destroy: vi.fn() } as unknown as GPUBuffer,
    indexBuffer: { destroy: vi.fn() } as unknown as GPUBuffer,
    vertexCount: 3,
    indexCount: 3,
    byteLength,
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 0 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

afterEach(() => clearGpuClodResidentPages());

describe("GPU CLOD resident cache leases", () => {
  it("pins active pages and gives the final release a reacquisition grace period", () => {
    let now = 0;
    const cache = new GpuClodResidentPageCache(
      {} as GPUDevice,
      {
        ...DEFAULT_GPU_CLOD_HIERARCHY_CONFIG,
        enabled: true,
        residentMaxLevel: 0,
        maxResidentBytes: 300,
      },
      () => now,
    );
    const first = page("L0:0,0", 200);
    const second = page("L0:1,0", 200);

    try {
      cache.adopt(first);
      const lease = acquireGpuClodResidentPage(first.id, first.revision);
      expect(lease).not.toBeNull();

      now = 6_000;
      expect(() => cache.adopt(second)).toThrow(/pinned pages/);
      expect(first.vertexBuffer.destroy).not.toHaveBeenCalled();
      expect(second.vertexBuffer.destroy).not.toHaveBeenCalled();

      lease?.release();
      now = 6_500;
      expect(() => cache.adopt(second)).toThrow(/pinned pages/);

      now = 7_001;
      cache.adopt(second);
      expect(cache.stats()).toMatchObject({
        residentPages: 1,
        residentBytes: 200,
        evictionsTotal: 1,
      });
      expect(first.vertexBuffer.destroy).toHaveBeenCalledTimes(1);
      expect(first.indexBuffer.destroy).toHaveBeenCalledTimes(1);
      expect(second.vertexBuffer.destroy).not.toHaveBeenCalled();
    } finally {
      cache.dispose();
    }
  });
});
