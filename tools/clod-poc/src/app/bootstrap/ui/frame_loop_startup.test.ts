import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { nonNegativeIntegerParam, runStreamingSelectionUpdate, usesInteractiveStreamingBudgets } from "./frame_loop_startup.js";

const startupDir = dirname(fileURLToPath(import.meta.url));

describe("runFrameLoopStartup", () => {
  it("freezes tile and root scheduling, then resumes each once", () => {
    const updateTiles = vi.fn();
    const updateRoots = vi.fn(() => "fresh");

    expect(runStreamingSelectionUpdate(false, "resident", updateTiles, updateRoots)).toBe("resident");
    expect(updateTiles).not.toHaveBeenCalled();
    expect(updateRoots).not.toHaveBeenCalled();

    expect(runStreamingSelectionUpdate(true, "resident", updateTiles, updateRoots)).toBe("fresh");
    expect(updateTiles).toHaveBeenCalledTimes(1);
    expect(updateRoots).toHaveBeenCalledTimes(1);
  });

  it("leaves an omitted streaming budget undefined so the controller default applies", () => {
    expect(nonNegativeIntegerParam(new URLSearchParams(), "liveClodRootBudget")).toBeUndefined();
    expect(nonNegativeIntegerParam(new URLSearchParams("liveClodRootBudget=0"), "liveClodRootBudget")).toBe(0);
  });

  it("uses convergence-safe streaming budgets for playable unbounded scenes", () => {
    expect(usesInteractiveStreamingBudgets("continent")).toBe(true);
    expect(usesInteractiveStreamingBudgets("infinite-islands")).toBe(true);
    expect(usesInteractiveStreamingBudgets("sanity")).toBe(false);
  });

  it("drains WebGPU timestamp queries even when named GPU timing is disabled", () => {
    const source = readFileSync(resolve(startupDir, "frame_loop_startup.ts"), "utf8");

    expect(source).toContain("new GpuPassTiming(input.app.renderer, gpuTimestampReady, wantGpuTiming && gpuTimestampReady)");
  });
});
