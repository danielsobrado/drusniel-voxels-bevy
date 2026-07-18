import { describe, expect, it } from "vitest";
import {
  DEFAULT_GPU_CLOD_HIERARCHY_CONFIG,
  parseGpuClodHierarchyConfig,
} from "./gpu_clod_hierarchy_config.js";
import { GPU_CLOD_SIMPLIFY_RUNTIME_WGSL } from "./gpu_clod_simplify_runtime_shader.js";

describe("reviewed GPU CLOD runtime contracts", () => {
  it("clamps excessive query-controlled GPU limits", () => {
    const config = parseGpuClodHierarchyConfig(new URLSearchParams([
      ["liveClodGpuReadbackMinLevel", "999999"],
      ["liveClodGpuResidentMaxLevel", "999999"],
      ["liveClodGpuResidentBytes", "999999999999"],
      ["liveClodGpuMeshletVertices", "999999"],
      ["liveClodGpuMeshletTriangles", "999999"],
      ["liveClodGpuSimplifyClusterCells", "999999"],
      ["liveClodGpuHashProbe", "999999"],
    ]));

    expect(config.readbackMinLevel).toBe(31);
    expect(config.residentMaxLevel).toBe(31);
    expect(config.maxResidentBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(config.meshletMaxVertices).toBe(256);
    expect(config.meshletMaxTriangles).toBe(256);
    expect(config.simplifyClusterSizeCells).toBe(64);
    expect(config.maxHashProbe).toBe(1024);
  });

  it("falls back for invalid below-minimum query values", () => {
    const config = parseGpuClodHierarchyConfig(new URLSearchParams([
      ["liveClodGpuResidentBytes", "-1"],
      ["liveClodGpuMeshletVertices", "2"],
      ["liveClodGpuMeshletTriangles", "0"],
      ["liveClodGpuSimplifyClusterCells", "0"],
      ["liveClodGpuHashProbe", "0"],
    ]));

    expect(config.maxResidentBytes).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.maxResidentBytes);
    expect(config.meshletMaxVertices).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.meshletMaxVertices);
    expect(config.meshletMaxTriangles).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.meshletMaxTriangles);
    expect(config.simplifyClusterSizeCells).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.simplifyClusterSizeCells);
    expect(config.maxHashProbe).toBe(DEFAULT_GPU_CLOD_HIERARCHY_CONFIG.maxHashProbe);
  });

  it("verifies cluster identity before simplifying hash matches", () => {
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).toContain("fn clusterCell");
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).toContain("fn sameCluster");
    // Locked owners are re-derived from the immutable input buffer, not a
    // cross-invocation output read.
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).toContain("isLocked(owner.positionMorph.xyz)");
  });

  it("keeps the simplify hash race-free: input-id slots, no cross-invocation waits", () => {
    // Slots claim the owner's INPUT vertex id; comparisons read inputVertices only.
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).toContain("array<atomic<u32>>");
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).toContain("0u, vertexId + 1u");
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).toContain("fn assignSimplifyOutputs");
    // The old output-id design spin-waited on another invocation's publish; the
    // race-free design has no wait loops at all.
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).not.toContain("publishWait");
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).not.toContain("valuePlusOne");
  });
});
