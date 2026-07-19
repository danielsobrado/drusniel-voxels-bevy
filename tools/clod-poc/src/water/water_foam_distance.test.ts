import { describe, expect, it, vi } from "vitest";
import {
  evaluateWaterFoamDistanceFade,
  getWaterFoamDistanceFadeState,
  publishWaterFoamDistanceFade,
  resolveWaterFoamDistanceFade,
  subscribeWaterFoamDistanceFade,
} from "./water_foam_distance.js";

describe("water foam distance policy", () => {
  it("sanitizes invalid and reversed configuration", () => {
    expect(resolveWaterFoamDistanceFade({
      detailFadeStartM: Number.NaN,
      detailFadeEndM: -4,
    })).toEqual({ startM: 0, endM: 0.001 });

    expect(resolveWaterFoamDistanceFade({
      detailFadeStartM: 320,
      detailFadeEndM: 120,
    })).toEqual({ startM: 320, endM: 320.001 });
  });

  it("evaluates a continuous smooth camera-distance fade", () => {
    const fade = { startM: 120, endM: 320 };

    expect(evaluateWaterFoamDistanceFade(0, fade)).toBe(1);
    expect(evaluateWaterFoamDistanceFade(120, fade)).toBe(1);
    expect(evaluateWaterFoamDistanceFade(220, fade)).toBeCloseTo(0.5);
    expect(evaluateWaterFoamDistanceFade(320, fade)).toBe(0);
    expect(evaluateWaterFoamDistanceFade(1_000, fade)).toBe(0);
  });

  it("publishes only real changes and notifies subscribers immediately", () => {
    const first = publishWaterFoamDistanceFade({ detailFadeStartM: 140, detailFadeEndM: 360 });
    const listener = vi.fn();
    const unsubscribe = subscribeWaterFoamDistanceFade(listener);

    expect(listener).toHaveBeenCalledWith(first);
    const unchanged = publishWaterFoamDistanceFade({ detailFadeStartM: 140, detailFadeEndM: 360 });
    expect(unchanged).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);

    const changed = publishWaterFoamDistanceFade({ detailFadeStartM: 160, detailFadeEndM: 400 });
    expect(changed.version).toBe(first.version + 1);
    expect(listener).toHaveBeenLastCalledWith(changed);
    expect(getWaterFoamDistanceFadeState()).toBe(changed);

    unsubscribe();
  });
});
