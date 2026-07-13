import { describe, expect, it, vi } from "vitest";
import { resetAcceptanceSampleWindow } from "./sample_window.js";

describe("resetAcceptanceSampleWindow", () => {
  it("resets both detailed perf samples and the phase-0 frame window", async () => {
    const resetPerf = vi.fn();
    const resetFrameMetrics = vi.fn();
    vi.stubGlobal("window", {
      __drusnielPerf: { reset: resetPerf },
      __drusnielResetPhase0FrameStats: resetFrameMetrics,
    });
    const page = { evaluate: async (callback: () => void) => callback() };

    await resetAcceptanceSampleWindow(page);

    expect(resetPerf).toHaveBeenCalledOnce();
    expect(resetFrameMetrics).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
