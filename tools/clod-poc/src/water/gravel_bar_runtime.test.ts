import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HYDROLOGY_CONFIG } from "./hydrologyConfig.js";
import {
  gravelBarStonesEnabled,
  resetGravelBarRuntimeOverrides,
  setGravelBarSettings,
  setGravelBarStonesEnabled,
} from "./gravel_bar_runtime.js";

beforeEach(() => {
  resetGravelBarRuntimeOverrides();
  setGravelBarSettings({
    ...DEFAULT_HYDROLOGY_CONFIG.gravelBars,
    enabled: true,
    strength: 1,
    stonesEnabled: false,
  });
});

describe("gravel bar runtime", () => {
  it("uses the configured default without a live override", () => {
    expect(gravelBarStonesEnabled("")).toBe(false);
    setGravelBarSettings({
      ...DEFAULT_HYDROLOGY_CONFIG.gravelBars,
      enabled: true,
      strength: 1,
      stonesEnabled: true,
    });
    expect(gravelBarStonesEnabled("")).toBe(true);
  });

  it("gives the live menu override highest precedence and can reset it", () => {
    setGravelBarStonesEnabled(true);
    expect(gravelBarStonesEnabled("")).toBe(true);
    setGravelBarStonesEnabled(false);
    expect(gravelBarStonesEnabled("")).toBe(false);

    resetGravelBarRuntimeOverrides();
    expect(gravelBarStonesEnabled("")).toBe(false);
  });

  it("fails closed when the shared bar field is disabled", () => {
    setGravelBarStonesEnabled(true);
    setGravelBarSettings({
      ...DEFAULT_HYDROLOGY_CONFIG.gravelBars,
      enabled: false,
      strength: 1,
      stonesEnabled: true,
    });
    expect(gravelBarStonesEnabled("")).toBe(false);
  });
});
