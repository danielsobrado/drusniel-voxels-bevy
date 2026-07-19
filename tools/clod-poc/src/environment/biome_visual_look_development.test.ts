import { afterEach, describe, expect, it } from "vitest";
import { serializeBiomeVisualLookYaml } from "../ui/gui/biome_visual_gui.js";
import type { BiomeVisualState } from "./biome_visual_state.js";
import {
  bindActiveBiomeVisualStateRuntime,
  clearBiomeVisualStateOverride,
  readActiveBiomeVisualState,
  readBiomeVisualStateOverride,
  setBiomeVisualStateOverride,
  type BiomeVisualStateRuntime,
} from "./biome_visual_state_runtime.js";

const base: BiomeVisualState = {
  enabled: true,
  seasonT: 0.25,
  green: 0.8,
  autumn: 0,
  bloom: 1,
  snowlineM: 1_500,
  glacialMurkiness: 0.6,
  morningMist: 0.4,
  pollenAmount: 0.7,
  frostAmount: 0.1,
  wetness: 0.2,
};

const runtime: BiomeVisualStateRuntime = {
  current: () => base,
  currentInput: () => ({ seasonT: base.seasonT, sunElevationDeg: 5, wetness: base.wetness }),
};

afterEach(() => {
  clearBiomeVisualStateOverride();
  bindActiveBiomeVisualStateRuntime(null);
});

describe("biome look development", () => {
  it("applies sanitized overrides without mutating the runtime state", () => {
    bindActiveBiomeVisualStateRuntime(runtime);
    setBiomeVisualStateOverride({ green: 2, autumn: -1, frostAmount: 0.75, snowlineM: -20 });

    const resolved = readActiveBiomeVisualState();
    expect(resolved).toMatchObject({ green: 1, autumn: 0, frostAmount: 0.75, snowlineM: 0 });
    expect(base).toMatchObject({ green: 0.8, autumn: 0, frostAmount: 0.1, snowlineM: 1_500 });
  });

  it("returns the base object after reset", () => {
    bindActiveBiomeVisualStateRuntime(runtime);
    setBiomeVisualStateOverride({ bloom: 0.2 });
    expect(readActiveBiomeVisualState()).not.toBe(base);

    clearBiomeVisualStateOverride();
    expect(readBiomeVisualStateOverride()).toBeNull();
    expect(readActiveBiomeVisualState()).toBe(base);
  });

  it("reuses the merged state while base and override are unchanged", () => {
    bindActiveBiomeVisualStateRuntime(runtime);
    setBiomeVisualStateOverride({ wetness: 0.9 });

    expect(readActiveBiomeVisualState()).toBe(readActiveBiomeVisualState());
  });

  it("exports deterministic YAML for review and reuse", () => {
    const yaml = serializeBiomeVisualLookYaml(base);
    expect(yaml).toContain("biome_visual_override:");
    expect(yaml).toContain("  season_t: 0.25");
    expect(yaml).toContain("  snowline_m: 1500");
    expect(yaml).toContain("  frost_amount: 0.1");
  });
});
