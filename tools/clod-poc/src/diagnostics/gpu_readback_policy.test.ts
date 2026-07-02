import { describe, expect, it } from "vitest";
import {
  allowsGpuReadbackKind,
  parseGpuReadbackMode,
  shouldRequestGpuReadback,
} from "./gpu_readback_policy.js";

describe("gpu_readback_policy", () => {
  it("defaults to off", () => {
    expect(parseGpuReadbackMode(new URLSearchParams())).toBe("off");
    expect(allowsGpuReadbackKind("grass_gpu_counts", new URLSearchParams())).toBe(false);
  });

  it("allows debug and acceptance count readbacks", () => {
    expect(allowsGpuReadbackKind("tree_gpu_counts", new URLSearchParams("gpuReadbacks=debug"))).toBe(true);
    expect(allowsGpuReadbackKind("tree_gpu_counts", new URLSearchParams("gpuReadbacks=acceptance"))).toBe(true);
  });

  it("keeps profile mode count readbacks disabled", () => {
    expect(allowsGpuReadbackKind("tree_gpu_counts", new URLSearchParams("gpuReadbacks=profile"))).toBe(false);
  });

  it("allows explicit per-kind opt in", () => {
    expect(allowsGpuReadbackKind("grass_gpu_counts", new URLSearchParams("grassGpuCounts=1"))).toBe(true);
  });

  it("throttles by frame interval", () => {
    expect(shouldRequestGpuReadback({ kind: "grass_gpu_counts", frame: 30, intervalFrames: 30, search: "gpuReadbacks=debug" })).toBe(true);
    expect(shouldRequestGpuReadback({ kind: "grass_gpu_counts", frame: 31, intervalFrames: 30, search: "gpuReadbacks=debug" })).toBe(false);
  });
});
