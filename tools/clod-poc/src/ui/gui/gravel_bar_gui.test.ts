import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HYDROLOGY_CONFIG } from "../../water/hydrologyConfig.js";
import {
  gravelBarStonesEnabled,
  resetGravelBarRuntimeOverrides,
  setGravelBarSettings,
  setGravelBedSettings,
} from "../../water/gravel_bar_runtime.js";
import { addGravelBarGui } from "./gravel_bar_gui.js";

interface AddCall {
  prop: string;
  target: Record<string, unknown>;
  disabled: boolean;
  onChange?: (value: unknown) => void;
  updateDisplay: ReturnType<typeof vi.fn>;
}

function fakeFolder(calls: AddCall[]): any {
  return {
    add(target: Record<string, unknown>, prop: string) {
      const call: AddCall = {
        prop,
        target,
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
  };
}

beforeEach(() => {
  resetGravelBarRuntimeOverrides();
  setGravelBarSettings({
    ...DEFAULT_HYDROLOGY_CONFIG.gravelBars,
    enabled: true,
    stonesEnabled: false,
  });
  setGravelBedSettings({
    ...DEFAULT_HYDROLOGY_CONFIG.gravelBed,
    enabled: false,
  });
});

describe("addGravelBarGui", () => {
  it("adds a live stone toggle and read-only bed authority status", () => {
    const calls: AddCall[] = [];
    const rebuildStones = vi.fn();

    addGravelBarGui(fakeFolder(calls), { rebuildStones });

    expect(calls.map((call) => call.prop)).toEqual([
      "stonesEnabled",
      "bedAuthority",
      "resetStonesOverride",
    ]);
    expect(calls.find((call) => call.prop === "bedAuthority")?.disabled).toBe(true);
    expect(calls.find((call) => call.prop === "bedAuthority")?.target.bedAuthority)
      .toBe("disabled in water.yaml");

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
