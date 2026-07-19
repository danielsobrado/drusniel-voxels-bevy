import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./index.js";
import {
  treeCpuFallbackGpuStatus,
  treeGpuRuntimeStatus,
  treeReportsGpuRingStats,
} from "./tree_system_gpu_status.js";

describe("tree system GPU status helpers", () => {
  it("resolves CPU fallback status from settings", () => {
    const settings = cloneTreeSettings();
    settings.gpu.enabled = false;
    settings.gpu.fallbackToCpu = true;
    expect(treeCpuFallbackGpuStatus(settings)).toBe("disabled");

    settings.gpu.enabled = true;
    settings.gpu.fallbackToCpu = true;
    expect(treeCpuFallbackGpuStatus(settings)).toBe("fallback-cpu");

    settings.gpu.fallbackToCpu = false;
    expect(treeCpuFallbackGpuStatus(settings)).toBe("disabled");
  });

  it("resolves runtime ring status when GPU resources are ready", () => {
    const settings = cloneTreeSettings();
    settings.gpu.fallbackToCpu = true;
    expect(treeGpuRuntimeStatus(settings, {
      supportsGpuTrees: true,
      hasDevice: true,
      hasBackend: true,
      unsupportedReason: null,
    })).toBe("ring");
  });

  it("resolves unavailable runtime to fallback or unsupported", () => {
    const settings = cloneTreeSettings();
    settings.gpu.fallbackToCpu = true;
    expect(treeGpuRuntimeStatus(settings, {
      supportsGpuTrees: false,
      hasDevice: true,
      hasBackend: true,
    })).toBe("fallback-cpu");

    settings.gpu.fallbackToCpu = false;
    expect(treeGpuRuntimeStatus(settings, {
      supportsGpuTrees: true,
      hasDevice: false,
      hasBackend: true,
    })).toBe("unsupported");

    expect(treeGpuRuntimeStatus(settings, {
      supportsGpuTrees: true,
      hasDevice: true,
      hasBackend: true,
      unsupportedReason: "missing feature",
    })).toBe("unsupported");
  });

  it("uses GPU lighting proxies only for a live compute and draw generation", () => {
    expect(treeReportsGpuRingStats(false, "ring", true, true, "ready")).toBe(false);
    expect(treeReportsGpuRingStats(true, "fallback-cpu", true, true, "ready")).toBe(false);
    expect(treeReportsGpuRingStats(true, "unsupported", true, true, "ready")).toBe(false);
    expect(treeReportsGpuRingStats(true, "error", true, true, "ready")).toBe(false);
    expect(treeReportsGpuRingStats(true, "ring", false, true, "ready")).toBe(false);
    expect(treeReportsGpuRingStats(true, "ring", true, false, "ready")).toBe(false);
    expect(treeReportsGpuRingStats(true, "ring", true, true, "initializing")).toBe(false);
    expect(treeReportsGpuRingStats(true, "ring", true, true, "failed")).toBe(false);
    expect(treeReportsGpuRingStats(true, "ring", true, true, "ready")).toBe(true);
    expect(treeReportsGpuRingStats(true, "ring", true, true, "running")).toBe(true);
  });
});
