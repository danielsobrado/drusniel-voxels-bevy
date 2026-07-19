import { describe, expect, it, vi } from "vitest";
import {
  createStreamingRootGpuGui,
  type StreamingRootGpuGuiDeps,
} from "./streaming_root_gpu_gui.js";
import type {
  StreamingRootGpuMesherConfig,
  StreamingRootGpuMesherRuntimeControls,
} from "../../terrain/streaming/streamed_root_gpu_config.js";

interface AddCall {
  folder: string;
  target: Record<string, unknown>;
  prop: string;
  options: unknown;
  disabled: boolean;
  onChange?: (value: unknown) => void;
  updateDisplay: ReturnType<typeof vi.fn>;
}

function createFakeGui(addCalls: AddCall[], folders: string[]) {
  const makeFolder = (folderName: string): any => ({
    add: (target: Record<string, unknown>, prop: string, options?: unknown) => {
      const call: AddCall = {
        folder: folderName,
        target,
        prop,
        options,
        disabled: false,
        updateDisplay: vi.fn(),
      };
      addCalls.push(call);
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

function createDeps() {
  let config: StreamingRootGpuMesherConfig = {
    enabled: true,
    fallback: true,
    batchSize: 4,
    maxInflightBatches: 2,
  };
  const setControls = vi.fn((next: Partial<StreamingRootGpuMesherRuntimeControls>) => {
    config = { ...config, ...next };
    return { enabled: config.enabled, fallback: config.fallback };
  });
  const resetControls = vi.fn(() => {
    config = { ...config, enabled: false, fallback: true };
    return { enabled: config.enabled, fallback: config.fallback };
  });
  const deps: StreamingRootGpuGuiDeps = {
    readConfig: () => ({ ...config }),
    setControls,
    resetControls,
  };
  return { deps, setControls, resetControls };
}

describe("createStreamingRootGpuGui", () => {
  it("adds live GPU and fallback controls plus startup diagnostics", () => {
    const addCalls: AddCall[] = [];
    const folders: string[] = [];
    const fixture = createDeps();

    createStreamingRootGpuGui(createFakeGui(addCalls, folders) as never, true, fixture.deps);

    expect(folders).toContain("CLOD GPU streaming");
    expect(addCalls.map((call) => call.prop)).toEqual([
      "enabled",
      "fallback",
      "batchSize",
      "maxInflightBatches",
      "resetOverrides",
    ]);
    expect(addCalls.find((call) => call.prop === "batchSize")?.disabled).toBe(true);
    expect(addCalls.find((call) => call.prop === "maxInflightBatches")?.disabled).toBe(true);

    addCalls.find((call) => call.prop === "enabled")?.onChange?.(false);
    addCalls.find((call) => call.prop === "fallback")?.onChange?.(false);
    expect(fixture.setControls).toHaveBeenNthCalledWith(1, { enabled: false });
    expect(fixture.setControls).toHaveBeenNthCalledWith(2, { fallback: false });
  });

  it("disables live GPU controls on WebGL", () => {
    const addCalls: AddCall[] = [];
    const fixture = createDeps();
    createStreamingRootGpuGui(createFakeGui(addCalls, []) as never, false, fixture.deps);

    expect(addCalls.find((call) => call.prop === "enabled")?.disabled).toBe(true);
    expect(addCalls.find((call) => call.prop === "fallback")?.disabled).toBe(true);
  });

  it("resets runtime overrides and refreshes live values", () => {
    const addCalls: AddCall[] = [];
    const fixture = createDeps();
    createStreamingRootGpuGui(createFakeGui(addCalls, []) as never, true, fixture.deps);

    const resetCall = addCalls.find((call) => call.prop === "resetOverrides")!;
    (resetCall.target.resetOverrides as () => void)();

    expect(fixture.resetControls).toHaveBeenCalledTimes(1);
    expect(addCalls.find((call) => call.prop === "enabled")?.updateDisplay).toHaveBeenCalledTimes(1);
    expect(addCalls.find((call) => call.prop === "fallback")?.updateDisplay).toHaveBeenCalledTimes(1);
  });
});
