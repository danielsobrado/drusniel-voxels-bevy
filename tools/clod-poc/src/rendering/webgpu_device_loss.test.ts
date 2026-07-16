import { describe, expect, it, vi } from "vitest";
import { handleWebGpuDeviceLoss } from "./webgpu_device_loss.js";

describe("WebGPU device-loss handling", () => {
  it("pauses simulation, preserves the save, then fails loudly", async () => {
    const order: string[] = [];
    const reporter = vi.fn(() => order.push("report"));
    let recovery: (() => Promise<void>) | null = null;

    await handleWebGpuDeviceLoss({ reason: "destroyed", message: "manual drill" }, {
      pauseSimulation: () => { order.push("pause"); },
      preserveSave: async () => { order.push("preserve"); },
      reporter,
      installControlledReload: (callback) => { recovery = callback; },
      reload: () => { order.push("reload"); },
    });

    expect(order).toEqual(["pause", "preserve", "report"]);
    expect(reporter).toHaveBeenCalledWith("WebGPU device lost", expect.arrayContaining([
      "Reason: destroyed",
      "Message: manual drill",
      "Simulation paused and pending save regions flushed.",
    ]));
    await recovery!();
    expect(order).toEqual(["pause", "preserve", "report", "preserve", "reload"]);
  });

  it("reports a save-preservation timeout instead of blocking the fail-loud report", async () => {
    vi.useFakeTimers();
    try {
      const reporter = vi.fn();
      const pending = handleWebGpuDeviceLoss({ reason: "unknown", message: "" }, {
        pauseSimulation: vi.fn(),
        preserveSave: () => new Promise<void>(() => { /* stalled flush */ }),
        reporter,
        installControlledReload: vi.fn(),
        reload: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;

      expect(reporter).toHaveBeenCalledWith("WebGPU device lost", expect.arrayContaining([
        "Save preservation failed: timed out after 10000ms",
      ]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays paused and reports a save-preservation failure without reloading", async () => {
    const reporter = vi.fn();
    const reload = vi.fn();

    await handleWebGpuDeviceLoss({ reason: "unknown", message: "" }, {
      pauseSimulation: vi.fn(),
      preserveSave: async () => { throw new Error("write failed"); },
      reporter,
      installControlledReload: vi.fn(),
      reload,
    });

    expect(reporter).toHaveBeenCalledWith("WebGPU device lost", expect.arrayContaining([
      "Save preservation failed: write failed",
    ]));
    expect(reload).not.toHaveBeenCalled();
  });
});
