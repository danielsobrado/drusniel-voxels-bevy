import { describe, expect, it } from "vitest";
import {
  decodeWaterHorizonSlope,
  encodeWaterHorizonSlope,
  resolveWaterSsrMissRoute,
} from "./water_ssr_miss_route_math.js";

describe("water SSR miss route", () => {
  it("routes open horizons to atmosphere and blocked horizons to directional probe GI", () => {
    const atmosphere = [0.2, 0.4, 0.8] as const;
    const probe = [0.18, 0.12, 0.08] as const;
    const terrain = [0.07, 0.09, 0.06] as const;
    expect(resolveWaterSsrMissRoute(true, true, atmosphere, probe, terrain)).toEqual(atmosphere);
    expect(resolveWaterSsrMissRoute(false, true, atmosphere, probe, terrain)).toEqual(probe);
    expect(resolveWaterSsrMissRoute(false, false, atmosphere, probe, terrain)).toEqual(terrain);
  });

  it("round-trips directional horizon slopes", () => {
    for (const slope of [-0.1, 0, 0.2, 0.6]) {
      expect(decodeWaterHorizonSlope(encodeWaterHorizonSlope(slope))).toBeCloseTo(slope, 5);
    }
  });
});
