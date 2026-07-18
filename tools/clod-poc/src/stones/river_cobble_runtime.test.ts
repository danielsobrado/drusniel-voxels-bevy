import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneEnvironmentalMaskSettings } from "../environment_masks/environment_mask_config.js";
import { setEnvironmentalMaskSettings } from "../environment_masks/environment_mask_runtime.js";
import {
  riverCobbleGpuEnabled,
  riverCobbleQueryEnabled,
  setRiverCobbleGpuEnabled,
  syncRiverCobbleQuery,
} from "./river_cobble_runtime.js";

afterEach(() => {
  setEnvironmentalMaskSettings(cloneEnvironmentalMaskSettings());
  setRiverCobbleGpuEnabled(null);
  vi.unstubAllGlobals();
});

describe("river cobble runtime flag", () => {
  it("is disabled by default", () => {
    expect(riverCobbleGpuEnabled("")).toBe(false);
  });

  it("accepts primary and alias enable flags", () => {
    expect(riverCobbleQueryEnabled("?riverCobbles=1")).toBe(true);
    expect(riverCobbleQueryEnabled("?underwaterCobbles=true")).toBe(true);
    expect(riverCobbleQueryEnabled("?stoneRiverCobbles")).toBe(true);
  });

  it("honors explicit disable values", () => {
    expect(riverCobbleQueryEnabled("?riverCobbles=0")).toBe(false);
    expect(riverCobbleQueryEnabled("?riverCobbles=off")).toBe(false);
  });

  it("lets the live menu override the initial query", () => {
    expect(riverCobbleGpuEnabled("?riverCobbles=1")).toBe(true);
    setRiverCobbleGpuEnabled(false);
    expect(riverCobbleGpuEnabled("?riverCobbles=1")).toBe(false);
    setRiverCobbleGpuEnabled(true);
    expect(riverCobbleGpuEnabled("?riverCobbles=0")).toBe(true);
  });

  it("canonicalizes aliases without reloading", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", {
      href: "https://example.test/?underwaterCobbles=1&stoneRiverCobbles=0&seed=7",
      search: "?underwaterCobbles=1&stoneRiverCobbles=0&seed=7",
    });
    vi.stubGlobal("history", { state: { marker: 1 }, replaceState });

    syncRiverCobbleQuery(false);

    expect(replaceState).toHaveBeenCalledOnce();
    const next = new URL(replaceState.mock.calls[0]![2]);
    expect(next.searchParams.get("riverCobbles")).toBe("0");
    expect(next.searchParams.has("underwaterCobbles")).toBe(false);
    expect(next.searchParams.has("stoneRiverCobbles")).toBe(false);
    expect(next.searchParams.get("seed")).toBe("7");
  });

  it("fails closed when YAML disables the shared layer or cobble mask", () => {
    const settings = cloneEnvironmentalMaskSettings();
    settings.riverCobble.enabled = false;
    setEnvironmentalMaskSettings(settings);
    setRiverCobbleGpuEnabled(true);
    expect(riverCobbleGpuEnabled("?riverCobbles=1")).toBe(false);

    settings.enabled = false;
    settings.riverCobble.enabled = true;
    setEnvironmentalMaskSettings(settings);
    expect(riverCobbleGpuEnabled("?riverCobbles=1")).toBe(false);
  });
});
