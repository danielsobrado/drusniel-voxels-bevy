import { describe, expect, it } from "vitest";
import {
  parsePostFxBounceSettings,
  projectedBounceRadiusUv,
} from "./postfx_bounce.js";

describe("postfx bounce", () => {
  it("parses and clamps yaml settings", () => {
    const settings = parsePostFxBounceSettings(`
postfx_bounce:
  enabled: true
  strength: 2
  radius_m: 0.7
  max_distance_m: 220
  depth_tolerance_m: 2.2
  min_uv_radius: 0.005
  max_uv_radius: 0.04
  taps: 99
`);
    expect(settings.enabled).toBe(true);
    expect(settings.strength).toBe(1);
    expect(settings.radiusMeters).toBeCloseTo(0.7);
    expect(settings.maxDistanceMeters).toBeCloseTo(220);
    expect(settings.depthToleranceMeters).toBeCloseTo(2.2);
    expect(settings.minUvRadius).toBeCloseTo(0.005);
    expect(settings.maxUvRadius).toBeCloseTo(0.04);
    expect(settings.taps).toBe(16);
  });

  it("keeps projected uv radius inside configured bounds", () => {
    expect(projectedBounceRadiusUv(0.55, 1, 0.004, 0.07)).toBeCloseTo(0.07);
    expect(projectedBounceRadiusUv(0.55, 1000, 0.004, 0.07)).toBeCloseTo(0.004);
    expect(projectedBounceRadiusUv(0.55, 55, 0.004, 0.07)).toBeCloseTo(0.01);
  });
});
