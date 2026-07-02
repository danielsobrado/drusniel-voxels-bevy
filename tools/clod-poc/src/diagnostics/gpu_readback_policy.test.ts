import { describe, expect, it } from "vitest";
import {
  allowsGpuReadbackKind,
  hasExplicitGpuReadbackOverride,
  parseGpuReadbackMode,
  shouldRequestGpuReadback,
  type GpuReadbackKind,
} from "./gpu_readback_policy.js";

const GPU_COUNT_KINDS: GpuReadbackKind[] = [
  "grass_gpu_counts",
  "prop_gpu_counts",
  "stone_gpu_counts",
  "tree_gpu_counts",
  "understory_gpu_counts",
];

describe("gpu_readback_policy", () => {
  it("defaults every gameplay GPU count readback to off", () => {
    const search = new URLSearchParams();
    expect(parseGpuReadbackMode(search)).toBe("off");
    for (const kind of GPU_COUNT_KINDS) {
      expect(allowsGpuReadbackKind(kind, search)).toBe(false);
      expect(shouldRequestGpuReadback({ kind, frame: 0, intervalFrames: 1, search })).toBe(false);
    }
  });

  it("allows debug and acceptance count readbacks through the central policy", () => {
    for (const kind of GPU_COUNT_KINDS) {
      expect(allowsGpuReadbackKind(kind, new URLSearchParams("gpuReadbacks=debug"))).toBe(true);
      expect(allowsGpuReadbackKind(kind, new URLSearchParams("gpuReadbacks=acceptance"))).toBe(true);
    }
  });

  it("keeps profile mode count readbacks disabled", () => {
    for (const kind of GPU_COUNT_KINDS) {
      expect(allowsGpuReadbackKind(kind, new URLSearchParams("gpuReadbacks=profile"))).toBe(false);
    }
  });

  it("does not let broad debug mode override a local disabled request", () => {
    expect(shouldRequestGpuReadback({
      kind: "prop_gpu_counts",
      frame: 0,
      intervalFrames: 1,
      requested: false,
      search: "gpuReadbacks=debug",
    })).toBe(false);
  });

  it("allows explicit per-kind opt in even when the local debug UI did not request it", () => {
    expect(hasExplicitGpuReadbackOverride("prop_gpu_counts", new URLSearchParams("propGpuCounts=1"))).toBe(true);
    expect(shouldRequestGpuReadback({
      kind: "prop_gpu_counts",
      frame: 0,
      intervalFrames: 1,
      requested: false,
      search: "propGpuCounts=1",
    })).toBe(true);
  });

  it("allows acceptance mode to force deterministic readbacks", () => {
    expect(shouldRequestGpuReadback({
      kind: "stone_gpu_counts",
      frame: 0,
      intervalFrames: 1,
      requested: false,
      search: "gpuReadbacks=acceptance",
    })).toBe(true);
  });

  it("throttles by frame interval", () => {
    expect(shouldRequestGpuReadback({ kind: "grass_gpu_counts", frame: 30, intervalFrames: 30, search: "gpuReadbacks=debug" })).toBe(true);
    expect(shouldRequestGpuReadback({ kind: "grass_gpu_counts", frame: 31, intervalFrames: 30, search: "gpuReadbacks=debug" })).toBe(false);
  });
});
