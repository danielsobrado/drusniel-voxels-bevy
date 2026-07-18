import { describe, expect, it } from "vitest";
import type { BiomeVisualStateSettings } from "./biome_visual_state_config.js";
import {
  BIOME_VISUAL_STATE_DEBUG_PROPERTY,
  createBiomeVisualStateRuntime,
  deriveBiomeVisualWetness,
  installBiomeVisualStateDebugProperty,
  resolveBiomeVisualSeasonT,
} from "./biome_visual_state_runtime.js";

const SETTINGS: BiomeVisualStateSettings = Object.freeze({
  enabled: true,
  seasonKeyframes: Object.freeze([
    Object.freeze({
      at: 0,
      green: 0,
      autumn: 0,
      bloom: 0,
      snowlineM: 800,
      glacialMurkiness: 0.8,
      pollenAmount: 0,
      frostAmount: 1,
    }),
    Object.freeze({
      at: 0.5,
      green: 1,
      autumn: 0,
      bloom: 0.5,
      snowlineM: 2200,
      glacialMurkiness: 0.5,
      pollenAmount: 0.4,
      frostAmount: 0,
    }),
  ]),
  morningMist: Object.freeze({
    startSunElevationDeg: -4,
    peakSunElevationDeg: 5,
    endSunElevationDeg: 18,
    strength: 0.6,
  }),
  defaultWetness: 0.1,
});

describe("biome visual state runtime", () => {
  it("reads live sun and weather owners while caching unchanged snapshots", () => {
    let sunElevationDeg = 5;
    let weatherMode = "off" as const | "rain";
    let weatherIntensity = 0;
    const runtime = createBiomeVisualStateRuntime({
      settings: SETTINGS,
      getSeasonT: () => 0.5,
      getSunElevationDeg: () => sunElevationDeg,
      getWeather: () => ({ mode: weatherMode, intensity: weatherIntensity }),
    });

    const first = runtime.current();
    expect(runtime.current()).toBe(first);
    expect(first.morningMist).toBeCloseTo(0.6, 6);
    expect(first.wetness).toBeCloseTo(0.1, 6);

    sunElevationDeg = 18;
    weatherMode = "rain";
    weatherIntensity = 0.75;
    const changed = runtime.current();

    expect(changed).not.toBe(first);
    expect(changed.morningMist).toBe(0);
    expect(changed.wetness).toBeCloseTo(0.75, 6);
  });

  it("uses precipitation as wetness only for rain and storms", () => {
    expect(deriveBiomeVisualWetness("off", 1, 0.2)).toBeCloseTo(0.2, 6);
    expect(deriveBiomeVisualWetness("snow", 1, 0.2)).toBeCloseTo(0.2, 6);
    expect(deriveBiomeVisualWetness("rain", 0.7, 0.2)).toBeCloseTo(0.7, 6);
    expect(deriveBiomeVisualWetness("storm", 1.4, 0.2)).toBe(1);
  });

  it("resolves an explicit season override without adding a clock", () => {
    expect(resolveBiomeVisualSeasonT(new URLSearchParams("biomeSeasonT=1.25"), 0)).toBeCloseTo(0.25, 6);
    expect(resolveBiomeVisualSeasonT(new URLSearchParams("biomeSeason=0.75"), 0)).toBeCloseTo(0.75, 6);
    expect(resolveBiomeVisualSeasonT(new URLSearchParams("biomeSeasonT=bad"), 0.5)).toBeCloseTo(0.5, 6);
  });

  it("publishes a getter-only debug snapshot", () => {
    const runtime = createBiomeVisualStateRuntime({
      settings: SETTINGS,
      getSeasonT: () => 0,
      getSunElevationDeg: () => 5,
      getWeather: () => ({ mode: "off", intensity: 0 }),
    });
    const target = {};

    installBiomeVisualStateDebugProperty(target, runtime);

    const descriptor = Object.getOwnPropertyDescriptor(target, BIOME_VISUAL_STATE_DEBUG_PROPERTY);
    expect(descriptor?.get).toBeTypeOf("function");
    expect(descriptor?.set).toBeUndefined();
    expect(Reflect.get(target, BIOME_VISUAL_STATE_DEBUG_PROPERTY)).toBe(runtime.current());
  });
});
