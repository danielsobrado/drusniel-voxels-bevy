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
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).toContain("representativeLocked");
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).toContain("publishWaitLimit");
    expect(GPU_CLOD_SIMPLIFY_RUNTIME_WGSL).not.toContain("while (valuePlusOne == 0u)");
  });
});
