import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GPU_CLOD_HIERARCHY_CONFIG } from "./gpu_clod_hierarchy_config.js";
import { GpuClodResidentPageCache } from "./gpu_clod_resident_page_cache.js";
import { createBufferedResidentAdoption } from "./gpu_clod_resident_adoption.js";
import {
  disabledGpuStats,
  type GpuClodRootMesher,
} from "./gpu_clod_root_mesher_single.js";
import type { GpuClodResidentPage } from "./gpu_clod_resident_types.js";

function page(id: string): GpuClodResidentPage {
  return {
    id,
    revision: 1,
    level: 0,
    vertexBuffer: { destroy: vi.fn() } as unknown as GPUBuffer,
    indexBuffer: { destroy: vi.fn() } as unknown as GPUBuffer,
    vertexCount: 3,
    indexCount: 3,
    byteLength: 256,
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 0 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function mesher(buildPages: GpuClodRootMesher["buildPages"]): GpuClodRootMesher {
  return {
    buildPages,
    stats: () => ({ ...disabledGpuStats(), enabled: 1 }),
    recordFallbackPages: () => undefined,
    recordWorkerFallbackPages: () => undefined,
    dispose: () => undefined,
  };
}

describe("buffered resident page adoption", () => {
  it("commits all pages atomically after the build succeeds", async () => {
    const adoptMany = vi.fn();
    const cache = { adoptMany } as unknown as GpuClodResidentPageCache;
    const adoption = createBufferedResidentAdoption(cache);
    const first = page("L0:0,0");
    const second = page("L0:1,0");
    const wrapped = adoption.wrap(mesher(async () => {
      adoption.onPage(first);
      adoption.onPage(second);
      return { nodes: [], buildMs: 1, transferBytes: 0 };
    }));

    await wrapped.buildPages([{ px: 0, pz: 0 }]);
    expect(adoptMany).toHaveBeenCalledTimes(1);
    expect(adoptMany).toHaveBeenCalledWith([first, second]);
    expect(first.vertexBuffer.destroy).not.toHaveBeenCalled();
    expect(second.vertexBuffer.destroy).not.toHaveBeenCalled();
  });

  it("destroys every staged page when the atomic cache commit fails", async () => {
    const cache = {
      adoptMany: vi.fn(() => { throw new Error("budget exceeded"); }),
    } as unknown as GpuClodResidentPageCache;
    const adoption = createBufferedResidentAdoption(cache);
    const first = page("L0:0,0");
    const second = page("L0:1,0");
    const wrapped = adoption.wrap(mesher(async () => {
      adoption.onPage(first);
      adoption.onPage(second);
      return { nodes: [], buildMs: 1, transferBytes: 0 };
    }));

    await expect(wrapped.buildPages([{ px: 0, pz: 0 }])).rejects.toThrow("budget exceeded");
    expect(first.vertexBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(first.indexBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(second.vertexBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(second.indexBuffer.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps rejection cleanup single-owned when the real cache is disabled", async () => {
    const cache = new GpuClodResidentPageCache(
      {} as GPUDevice,
      { ...DEFAULT_GPU_CLOD_HIERARCHY_CONFIG, enabled: false },
    );
    const adoption = createBufferedResidentAdoption(cache);
    const resident = page("L0:0,0");
    const wrapped = adoption.wrap(mesher(async () => {
      adoption.onPage(resident);
      return { nodes: [], buildMs: 1, transferBytes: 0 };
    }));

    await expect(wrapped.buildPages([{ px: 0, pz: 0 }])).rejects.toThrow("cache is disabled");
    expect(resident.vertexBuffer.destroy).toHaveBeenCalledTimes(1);
    expect(resident.indexBuffer.destroy).toHaveBeenCalledTimes(1);
  });
});
