import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HYDROLOGY_CONFIG } from "../../water/hydrologyConfig.js";
import {
  gravelBarStonesEnabled,
  resetGravelBarRuntimeOverrides,
  setGravelBarSettings,
} from "../../water/gravel_bar_runtime.js";
import { addGravelBarGui } from "./gravel_bar_gui.js";

interface AddCall {
  prop: string;
  target: Record<string, unknown>;
  onChange?: (value: unknown) => void;
  updateDisplay: ReturnType<typeof vi.fn>;
}

function fakeFolder(calls: AddCall[]): any {
  return {
    add(target: Record<string, unknown>, prop: string) {
      const call: AddCall = {
        prop,
        target,
        updateDisplay: vi.fn(),
      };
      calls.push(call);
      const controller = {
        name: () => controller,
        onChange: (handler: (value: unknown) => void) => {
          call.onChange = handler;
          return controller;
        },
        updateDisplay: call.updateDisplay,
      };
      return controller;
    },
  };
}

beforeEach(() => {
  resetGravelBarRuntimeOverrides();
  setGravelBarSettings({
    ...DEFAULT_HYDROLOGY_CONFIG.gravelBars,
    enabled: true,
    stonesEnabled: false,
  });
});

describe("addGravelBarGui", () => {
  it("adds a live stone toggle", () => {
    const calls: AddCall[] = [];
    const rebuildStones = vi.fn();

    addGravelBarGui(fakeFolder(calls), { rebuildStones });

    expect(calls.map((call) => call.prop)).toEqual([
      "stonesEnabled",
      "resetStonesOverride",
    ]);

    calls.find((call) => call.prop === "stonesEnabled")?.onChange?.(true);
    expect(gravelBarStonesEnabled("")).toBe(true);
    expect(rebuildStones).toHaveBeenCalledTimes(1);
  });

  it("resets the live override to the configured setting", () => {
    const calls: AddCall[] = [];
    const rebuildStones = vi.fn();
    addGravelBarGui(fakeFolder(calls), { rebuildStones });
    calls.find((call) => call.prop === "stonesEnabled")?.onChange?.(true);

    const reset = calls.find((call) => call.prop === "resetStonesOverride")!;
    (reset.target.resetStonesOverride as () => void)();

    expect(gravelBarStonesEnabled("")).toBe(false);
    expect(calls.find((call) => call.prop === "stonesEnabled")?.updateDisplay).toHaveBeenCalledTimes(1);
    expect(rebuildStones).toHaveBeenCalledTimes(2);
  });
});
