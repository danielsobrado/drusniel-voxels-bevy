import { describe, expect, it, vi } from "vitest";
import { createStreamingRootGpuGui } from "./streaming_root_gpu_gui.js";
import type { StreamingRootGpuGuiDeps } from "./streaming_root_gpu_gui.js";

interface AddCall {
  folder: string;
  target: Record<string, unknown>;
  prop: string;
  disabled: boolean;
  onChange?: (value: unknown) => void;
  updateDisplay: ReturnType<typeof vi.fn>;
}

function createFakeGui(calls: AddCall[], folders: string[]) {
  const makeFolder = (folderName: string): any => ({
    add: (target: Record<string, unknown>, prop: string) => {
      const call: AddCall = {
        folder: folderName,
        target,
        prop,
        disabled: false,
        updateDisplay: vi.fn(),
      };
      calls.push(call);
      const controller = {
        name: () => controller,
        onChange: (handler: (value: unknown) => void) => {
          call.onChange = handler;
          return controller;
        },
        disable: () => {
          call.disabled = true;
          return controller;
        },
        updateDisplay: call.updateDisplay,
      };
      return controller;
    },
  });
  return {
    addFolder: (name: string) => {
      folders.push(name);
      return makeFolder(name);
    },
  };
}

function createDeps(): StreamingRootGpuGuiDeps & {
  setControls: ReturnType<typeof vi.fn>;
  resetControls: ReturnType<typeof vi.fn>;
} {
  let config = {
    enabled: true,
    fallback: true,
    batchSize: 4,
    maxInflightBatches: 2,
  };
  const setControls = vi.fn((next) => {
    config = { ...config, ...next };
    return { enabled: config.enabled, fallback: config.fallback };
  });
  const resetControls = vi.fn(() => {
    config = { ...config, enabled: false, fallback: true };
    return { enabled: config.enabled, fallback: config.fallback };
  });
  return {
    readConfig: () => ({ ...config }),
    setControls,
    resetControls,
  };
}

describe("createStreamingRootGpuGui", () => {
  it("adds live GPU and fallback controls plus startup diagnostics", () => {
    const calls: AddCall[] = [];
    const folders: string[] = [];
    const deps = createDeps();

    createStreamingRootGpuGui(createFakeGui(calls, folders) as never, true, deps);

    expect(folders).toContain("CLOD GPU streaming");
    expect(calls.map((call) => call.prop)).toEqual([
      "enabled",
      "fallback",
      "batchSize",
      "maxInflightBatches",
      "resetOverrides",
    ]);
    expect(calls.find((call) => call.prop === "batchSize")?.disabled).toBe(true);
    expect(calls.find((call) => call.prop === "maxInflightBatches")?.disabled).toBe(true);

    calls.find((call) => call.prop === "enabled")?.onChange?.(false);
    calls.find((call) => call.prop === "fallback")?.onChange?.(false);
    expect(deps.setControls).toHaveBeenNthCalledWith(1, { enabled: false });
    expect(deps.setControls).toHaveBeenNthCalledWith(2, { fallback: false });
  });

  it("disables live GPU controls on WebGL", () => {
    const calls: AddCall[] = [];
    createStreamingRootGpuGui(createFakeGui(calls, []) as never, false, createDeps());

    expect(calls.find((call) => call.prop === "enabled")?.disabled).toBe(true);
    expect(calls.find((call) => call.prop === "fallback")?.disabled).toBe(true);
  });

  it("resets runtime overrides and refreshes live values", () => {
    const calls: AddCall[] = [];
    const deps = createDeps();
    createStreamingRootGpuGui(createFakeGui(calls, []) as never, true, deps);

    const resetCall = calls.find((call) => call.prop === "resetOverrides")!;
    (resetCall.target.resetOverrides as () => void)();

    expect(deps.resetControls).toHaveBeenCalledTimes(1);
    expect(calls.find((call) => call.prop === "enabled")?.updateDisplay).toHaveBeenCalledTimes(1);
    expect(calls.find((call) => call.prop === "fallback")?.updateDisplay).toHaveBeenCalledTimes(1);
  });
});
