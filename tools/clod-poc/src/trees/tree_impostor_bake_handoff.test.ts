import { describe, expect, it, vi } from "vitest";
import { cloneTreeSettings } from "./tree_config.js";
import {
  executeTreeImpostorBakeHandoff,
  treeImpostorBakeHandoffAction,
} from "./tree_impostor_bake_handoff.js";

describe("tree impostor bake handoff", () => {
  it("does nothing for an unsupported bake", () => {
    expect(treeImpostorBakeHandoffAction(cloneTreeSettings(), false)).toBe("none");
  });

  it("swaps live consumers when configured", () => {
    const settings = cloneTreeSettings();
    settings.impostors.swapOnBake = true;
    expect(treeImpostorBakeHandoffAction(settings, true)).toBe("swap-live");
  });

  it("rebuilds GPU consumers when live swapping is disabled", () => {
    const settings = cloneTreeSettings();
    settings.impostors.swapOnBake = false;
    settings.gpu.enabled = true;
    settings.gpu.scatterEnabled = true;
    settings.gpu.cullEnabled = true;
    settings.gpu.debugForceCpu = false;
    expect(treeImpostorBakeHandoffAction(settings, true)).toBe("rebuild-gpu");
  });

  it("rebuilds CPU consumers when live swapping is disabled", () => {
    const settings = cloneTreeSettings();
    settings.impostors.swapOnBake = false;
    settings.gpu.debugForceCpu = true;
    expect(treeImpostorBakeHandoffAction(settings, true)).toBe("rebuild-cpu");
  });

  it("resets both consumer paths when a live swap fails", () => {
    const operations = operationsForTest();
    operations.swapLive.mockImplementation(() => {
      throw new Error("replacement failed");
    });

    expect(() => executeTreeImpostorBakeHandoff("swap-live", operations)).toThrow("replacement failed");
    expect(operations.resetGpuConsumers).toHaveBeenCalledTimes(1);
    expect(operations.resetCpuConsumers).toHaveBeenCalledTimes(1);
    expect(operations.rebuildGpu).not.toHaveBeenCalled();
    expect(operations.rebuildCpu).not.toHaveBeenCalled();
  });

  it("does not reset consumers after a successful live swap", () => {
    const operations = operationsForTest();

    executeTreeImpostorBakeHandoff("swap-live", operations);

    expect(operations.swapLive).toHaveBeenCalledTimes(1);
    expect(operations.resetGpuConsumers).not.toHaveBeenCalled();
    expect(operations.resetCpuConsumers).not.toHaveBeenCalled();
  });
});

type OperationMock = ReturnType<typeof vi.fn<() => void>>;

function operationsForTest(): {
  swapLive: OperationMock;
  rebuildGpu: OperationMock;
  rebuildCpu: OperationMock;
  resetGpuConsumers: OperationMock;
  resetCpuConsumers: OperationMock;
} {
  return {
    swapLive: vi.fn<() => void>(),
    rebuildGpu: vi.fn<() => void>(),
    rebuildCpu: vi.fn<() => void>(),
    resetGpuConsumers: vi.fn<() => void>(),
    resetCpuConsumers: vi.fn<() => void>(),
  };
}
