import { describe, expect, it } from "vitest";
import { treeGpuCpuPatchHandoffAction } from "./tree_system_gpu_cpu_handoff.js";

describe("tree GPU/CPU patch handoff", () => {
  it("keeps CPU patches while GPU resources are still initializing", () => {
    expect(treeGpuCpuPatchHandoffAction({
      gpuUpdated: true,
      gpuReady: false,
      fallbackToCpu: true,
    })).toBe("keep");
  });

  it("retires CPU patches after the GPU ring is live", () => {
    expect(treeGpuCpuPatchHandoffAction({
      gpuUpdated: true,
      gpuReady: true,
      fallbackToCpu: true,
    })).toBe("retire");
  });

  it("keeps CPU patches after a GPU failure when fallback is enabled", () => {
    expect(treeGpuCpuPatchHandoffAction({
      gpuUpdated: false,
      gpuReady: false,
      fallbackToCpu: true,
    })).toBe("keep");
  });

  it("retires CPU patches after a GPU failure when fallback is disabled", () => {
    expect(treeGpuCpuPatchHandoffAction({
      gpuUpdated: false,
      gpuReady: false,
      fallbackToCpu: false,
    })).toBe("retire");
  });
});
