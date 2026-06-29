import { describe, expect, it } from "vitest";
import {
  treeGpuValidationMessage,
  treeGpuValidationTolerance,
  validateTreeGpuRingCounts,
} from "./tree_system_gpu_validation.js";

describe("tree GPU validation helpers", () => {
  it("uses at least four trees as tolerance", () => {
    expect(treeGpuValidationTolerance(
      { near: 1, mid: 1, far: 1, impostor: 1 },
      { near: 0, mid: 0, far: 0, impostor: 0 },
    )).toBe(4);
  });

  it("scales tolerance with visible tree count", () => {
    expect(treeGpuValidationTolerance(
      { near: 100, mid: 100, far: 100, impostor: 100 },
      { near: 1000, mid: 0, far: 0, impostor: 0 },
    )).toBe(20);
  });

  it("accepts matching counts within tolerance", () => {
    const result = validateTreeGpuRingCounts(
      { counts: { near: 10, mid: 20, far: 30, impostor: 40 }, overflowed: false },
      { counts: { near: 12, mid: 18, far: 30, impostor: 40 }, overflowed: false },
    );

    expect(result.maxDelta).toBe(2);
    expect(result.tolerance).toBe(4);
    expect(result.overflowMismatch).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.message).toBeNull();
  });

  it("rejects counts above tolerance", () => {
    const result = validateTreeGpuRingCounts(
      { counts: { near: 10, mid: 20, far: 30, impostor: 40 }, overflowed: false },
      { counts: { near: 30, mid: 20, far: 30, impostor: 40 }, overflowed: false },
    );

    expect(result.maxDelta).toBe(20);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("maxDelta=20 tolerance=4");
  });

  it("rejects overflow mismatch", () => {
    const result = validateTreeGpuRingCounts(
      { counts: { near: 10, mid: 20, far: 30, impostor: 40 }, overflowed: true },
      { counts: { near: 10, mid: 20, far: 30, impostor: 40 }, overflowed: false },
    );

    expect(result.maxDelta).toBe(0);
    expect(result.overflowMismatch).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("overflow gpu=true cpu=false");
  });

  it("formats validation warning messages", () => {
    expect(treeGpuValidationMessage(
      { counts: { near: 1, mid: 2, far: 3, impostor: 4 }, overflowed: false },
      { counts: { near: 5, mid: 6, far: 7, impostor: 8 }, overflowed: true },
      4,
      9,
    )).toBe(
      "[trees-gpu-ring] CPU/GPU count parity failed " +
      "gpu=1/2/3/4 cpu=5/6/7/8 maxDelta=4 tolerance=9 overflow gpu=false cpu=true",
    );
  });
});
