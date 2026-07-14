import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nonNegativeIntegerParam, usesInteractiveStreamingBudgets } from "./frame_loop_startup.js";

const startupDir = dirname(fileURLToPath(import.meta.url));

describe("runFrameLoopStartup", () => {
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
