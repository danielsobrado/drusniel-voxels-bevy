import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClodPageNode } from "../../types.js";
import {
  DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG,
  validateStreamedPageBounds,
} from "./streamed_page_bounds_guard.js";
import {
  clearGpuClodResidentPages,
  registerGpuClodResidentPage,
} from "./gpu_clod_resident_registry.js";

const EMPTY_MESH = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  paintSlots: new Float32Array(0),
  materialWeights: new Float32Array(0),
  materialWeightStride: 4,
  indices: new Uint32Array(0),
};

function residentNode(): ClodPageNode {
  return {
    id: "L0:0,0",
    revision: 1,
    level: 0,
    children: [],
    mesh: EMPTY_MESH,
    footprint: { minX: 0, minZ: 0, maxX: 16, maxZ: 16 },
    bounds: { center: [8, 2, 8], radius: 12, minY: 0, maxY: 4 },
    errorWorld: 0,
    lowBenefit: false,
    gpuResidentOnly: true,
  };
}

afterEach(() => clearGpuClodResidentPages());

describe("resident streamed page validation", () => {
  it("rejects missing resident buffers even when optional bounds checks are disabled", () => {
    const result = validateStreamedPageBounds(
      residentNode(),
      16,
      { ...DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG, enabled: false },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unexpected_empty_mesh");
  });

  it("accepts a registered non-empty resident page with optional bounds checks disabled", () => {
    const node = residentNode();
    registerGpuClodResidentPage({
      id: node.id,
      revision: node.revision!,
      level: node.level,
      vertexBuffer: { destroy: vi.fn() } as unknown as GPUBuffer,
      indexBuffer: { destroy: vi.fn() } as unknown as GPUBuffer,
      vertexCount: 3,
      indexCount: 3,
      byteLength: 256,
      bounds: node.bounds,
      errorWorld: node.errorWorld,
      lowBenefit: node.lowBenefit,
    });

    const result = validateStreamedPageBounds(
      node,
      16,
      { ...DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG, enabled: false },
    );
    expect(result.ok).toBe(true);
    expect(result.vertexCount).toBe(3);
    expect(result.triangleCount).toBe(1);
  });
});
