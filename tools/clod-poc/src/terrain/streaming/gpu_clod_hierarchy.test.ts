import { describe, expect, it, vi } from "vitest";
import type { ClodPageNode, PageMesh } from "../../types.js";
import {
  DEFAULT_GPU_CLOD_HIERARCHY_CONFIG,
  parseGpuClodHierarchyConfig,
  shouldKeepGpuClodPageResident,
} from "./gpu_clod_hierarchy_config.js";
import { buildGpuClodMeshletHierarchy } from "./gpu_clod_meshlet_hierarchy.js";
import { GpuClodResidentPageCache } from "./gpu_clod_resident_page_cache.js";
import type { GpuClodResidentPage } from "./gpu_clod_resident_types.js";
import {
  GPU_CLOD_SIMPLIFY_RUNTIME_WGSL,
  GPU_CLOD_WELD_RUNTIME_WGSL,
} from "./gpu_clod_page_compute_shaders.js";
import {
  GPU_CLOD_PACKED_VERTEX_FLOATS,
  GPU_CLOD_WELD_WGSL,
  packGpuClodMesh,
} from "./gpu_clod_weld_compute.js";
import { GPU_CLOD_SIMPLIFY_WGSL } from "./gpu_clod_simplify_compute.js";

describe("GPU CLOD hierarchy config", () => {
  it("keeps the complete path behind one explicit runtime flag", () => {
    const config = parseGpuClodHierarchyConfig(new URLSearchParams("scene=infinite-islands"));
    expect(config.enabled).toBe(false);
    expect(config.renderResidentPages).toBe(true);
    expect(config.readbackMinLevel).toBe(1);
    expect(config.residentMaxLevel).toBe(0);
    expect(config.gpuWeld).toBe(true);
    expect(config.gpuSimplify).toBe(true);
  });

  it("keeps defaults for missing and blank numeric options", () => {
    const missing = parseGpuClodHierarchyConfig(new URLSearchParams());
    const blank = parseGpuClodHierarchyConfig(new URLSearchParams([
      ["liveClodGpuReadbackMinLevel", ""],
      ["liveClodGpuResidentMaxLevel", "   "],
    ]));
    expect(missing.readbackMinLevel).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.readbackMinLevel);
    expect(missing.residentMaxLevel).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.residentMaxLevel);
    expect(blank.readbackMinLevel).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.readbackMinLevel);
    expect(blank.residentMaxLevel).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.residentMaxLevel);
  });

  it("parses bounded hierarchy options", () => {
    const config = parseGpuClodHierarchyConfig(new URLSearchParams([
      ["liveClodGpuHierarchy", "1"],
      ["liveClodGpuResidentRender", "0"],
      ["liveClodGpuReadbackMinLevel", "2"],
      ["liveClodGpuResidentMaxLevel", "2"],
      ["liveClodGpuResidentBytes", "1048576"],
      ["liveClodGpuMeshletVertices", "48"],
      ["liveClodGpuMeshletTriangles", "32"],
      ["liveClodGpuWeld", "1"],
      ["liveClodGpuSimplify", "1"],
      ["liveClodGpuSimplifyClusterCells", "2.5"],
      ["liveClodGpuHashProbe", "128"],
    ]));
    expect(config).toMatchObject({
      enabled: true,
      renderResidentPages: false,
      readbackMinLevel: 2,
      residentMaxLevel: 2,
      maxResidentBytes: 1_048_576,
      meshletMaxVertices: 48,
      meshletMaxTriangles: 32,
      gpuWeld: true,
      gpuSimplify: true,
      simplifyClusterSizeCells: 2.5,
      maxHashProbe: 128,
    });
  });

  it("uses stable defaults for invalid values", () => {
    const config = parseGpuClodHierarchyConfig(new URLSearchParams("liveClodGpuResidentBytes=-1"));
    expect(config.maxResidentBytes).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.maxResidentBytes);
  });

  it("gives each level one geometry authority", () => {
    const config = {
      ...DEFAULT_GPU_CLOD_HIERARCHY_CONFIG,
      enabled: true,
      renderResidentPages: true,
      residentMaxLevel: 2,
      readbackMinLevel: 1,
    };
    expect(shouldKeepGpuClodPageResident(config, 0)).toBe(true);
    expect(shouldKeepGpuClodPageResident(config, 1)).toBe(false);
    expect(shouldKeepGpuClodPageResident(config, 2)).toBe(false);
  });
});

describe("GPU CLOD meshlet hierarchy", () => {
  it("partitions triangles without exceeding limits", () => {
    const mesh = gridMesh(5, 5);
    const hierarchy = buildGpuClodMeshletHierarchy(mesh, { maxVertices: 8, maxTriangles: 4 });
    expect(hierarchy.meshletCount).toBeGreaterThan(1);
    expect(hierarchy.hierarchyNodeCount).toBeGreaterThan(hierarchy.meshletCount);
    for (let meshlet = 0; meshlet < hierarchy.meshletCount; meshlet++) {
      const base = meshlet * 8;
      expect(hierarchy.meshletHeaders[base + 1]).toBeLessThanOrEqual(8);
      expect(hierarchy.meshletHeaders[base + 3]).toBeLessThanOrEqual(4);
    }
    expect(hierarchy.triangleIndices.length).toBe(mesh.indices.length);
  });

  it("is deterministic", () => {
    const mesh = gridMesh(4, 4);
    const first = buildGpuClodMeshletHierarchy(mesh, { maxVertices: 12, maxTriangles: 8 });
    const second = buildGpuClodMeshletHierarchy(mesh, { maxVertices: 12, maxTriangles: 8 });
    expect([...first.meshletHeaders]).toEqual([...second.meshletHeaders]);
    expect([...first.vertexIndices]).toEqual([...second.vertexIndices]);
    expect([...first.triangleIndices]).toEqual([...second.triangleIndices]);
    expect([...first.hierarchyHeaders]).toEqual([...second.hierarchyHeaders]);
    expect([...first.bounds]).toEqual([...second.bounds]);
  });
});

describe("GPU CLOD resident page cache", () => {
  it("re-uploads a rebuilt page when its mesh identity changes at the same numeric revision", () => {
    const previousUsage = Object.getOwnPropertyDescriptor(globalThis, "GPUBufferUsage");
    Object.defineProperty(globalThis, "GPUBufferUsage", {
      configurable: true,
      value: { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, VERTEX: 8, INDEX: 16 },
    });
    let destroyed = 0;
    const device = {
      queue: { writeBuffer: () => undefined },
      createBuffer: () => ({ destroy: () => { destroyed++; } }),
    } as unknown as GPUDevice;
    const cache = new GpuClodResidentPageCache(device, {
      ...DEFAULT_GPU_CLOD_HIERARCHY_CONFIG,
      enabled: true,
      meshlets: false,
      maxResidentBytes: 1_048_576,
    });
    try {
      const first = gridMesh(2, 2);
      const second = gridMesh(2, 2);
      second.positions[1] = 1;
      cache.ingest([pageNode(first, 1)]);
      cache.ingest([pageNode(first, 1)]);
      expect(cache.stats().uploadsTotal).toBe(1);
      cache.ingest([pageNode(second, 1)]);
      expect(cache.stats().uploadsTotal).toBe(2);
      expect(destroyed).toBe(2);
    } finally {
      cache.dispose();
      if (previousUsage) Object.defineProperty(globalThis, "GPUBufferUsage", previousUsage);
      else delete (globalThis as unknown as { GPUBufferUsage?: unknown }).GPUBufferUsage;
    }
  });

  it("expires first-view protection instead of pinning a full cache forever", () => {
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
    const first = residentPage("L0:0,0", 200);
    const second = residentPage("L0:1,0", 200);
    try {
      cache.adopt(first);
      now = 100;
      expect(() => cache.adopt(second)).toThrow(/pending first-view pages/);
      now = 6_000;
      cache.adopt(second);
      expect(cache.stats().residentPages).toBe(1);
      expect(cache.stats().residentBytes).toBe(200);
      expect(cache.stats().evictionsTotal).toBe(1);
      expect(first.vertexBuffer.destroy).toHaveBeenCalledTimes(1);
    } finally {
      cache.dispose();
    }
  });
});

describe("GPU CLOD compute contracts", () => {
  it("packs the canonical four-channel page attributes", () => {
    const mesh = gridMesh(2, 2);
    const packed = packGpuClodMesh(mesh);
    expect(packed.vertices.length).toBe((mesh.positions.length / 3) * GPU_CLOD_PACKED_VERTEX_FLOATS);
    expect(packed.indices).toBe(mesh.indices);
    expect(packed.vertices[3]).toBe(mesh.paintSlots[0]);
    expect([...packed.vertices.slice(8, 12)]).toEqual([...mesh.materialWeights.slice(0, 4)]);
  });

  it("exports separate weld and simplification entrypoints", () => {
    expect(GPU_CLOD_WELD_WGSL).toContain("fn weld_vertices");
    expect(GPU_CLOD_WELD_WGSL).toContain("fn compact_triangles");
    expect(GPU_CLOD_SIMPLIFY_WGSL).toContain("fn simplify_vertices");
    expect(GPU_CLOD_SIMPLIFY_WGSL).toContain("fn simplify_triangles");
    expect(GPU_CLOD_SIMPLIFY_WGSL).toContain("fn is_locked");
  });

  it("keeps hash reductions race-free: input-id slots, no cross-workgroup waits", () => {
    for (const source of [GPU_CLOD_WELD_RUNTIME_WGSL, GPU_CLOD_SIMPLIFY_RUNTIME_WGSL]) {
      // Slots claim the owner's INPUT vertex id so comparisons read the immutable
      // input buffer; output compaction runs as its own pass. WGSL guarantees no
      // cross-workgroup visibility for non-atomic writes, so the shader must not
      // wait on or read another invocation's output.
      expect(source).toContain("array<atomic<u32>>");
      expect(source).toContain("0u, vertexId + 1u");
      expect(source).not.toContain("publishWait");
      expect(source).not.toContain("valuePlusOne");
    }
    expect(GPU_CLOD_WELD_RUNTIME_WGSL).toContain("fn assignWeldOutputs");
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).toContain("fn assignSimplifyOutputs");
  });
});

function pageNode(mesh: PageMesh, revision: number): ClodPageNode {
  return {
    id: "L0:0,0",
    revision,
    level: 0,
    children: [],
    mesh,
    footprint: { minX: 0, minZ: 0, maxX: 2, maxZ: 2 },
    bounds: { center: [0.5, 0, 0.5], radius: 1, minY: 0, maxY: 0 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function residentPage(id: string, byteLength: number): GpuClodResidentPage {
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

function gridMesh(width: number, depth: number): PageMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const paintSlots: number[] = [];
  const materialWeights: number[] = [];
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      paintSlots.push(0);
      materialWeights.push(1, 0, 0, 0);
    }
  }
  const indices: number[] = [];
  for (let z = 0; z < depth - 1; z++) {
    for (let x = 0; x < width - 1; x++) {
      const a = z * width + x;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    paintSlots: Float32Array.from(paintSlots),
    materialWeights: Float32Array.from(materialWeights),
    materialWeightStride: 4,
    indices: Uint32Array.from(indices),
  };
}
