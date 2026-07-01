import { describe, expect, it } from "vitest";
import {
  parsePostFxGtaoSettings,
  projectedGtaoRadiusUv,
} from "./postfx_gtao.js";

describe("postfx gtao", () => {
  it("parses and clamps yaml settings", () => {
    const settings = parsePostFxGtaoSettings(`
postfx_gtao:
  enabled: true
  samples: 99
  radius_m: 2.2
  strength: 2
  max_distance_m: 800
  fade_end_m: 400
  depth_bias_m: -1
  depth_tolerance_m: 1.4
  min_uv_radius: 0.003
  max_uv_radius: 0.02
`);
    expect(settings.enabled).toBe(true);
    expect(settings.samples).toBe(16);
    expect(settings.radiusMeters).toBeCloseTo(2.2);
    expect(settings.strength).toBe(1);
    expect(settings.maxDistanceMeters).toBeCloseTo(800);
    expect(settings.fadeEndMeters).toBeCloseTo(800);
    expect(settings.depthBiasMeters).toBe(0);
    expect(settings.depthToleranceMeters).toBeCloseTo(1.4);
    expect(settings.minUvRadius).toBeCloseTo(0.003);
    expect(settings.maxUvRadius).toBeCloseTo(0.02);
  });

  it("keeps projected uv radius inside configured bounds", () => {
    expect(projectedGtaoRadiusUv(1.6, 1, 0.002, 0.035)).toBeCloseTo(0.035);
    expect(projectedGtaoRadiusUv(1.6, 2000, 0.002, 0.035)).toBeCloseTo(0.002);
    expect(projectedGtaoRadiusUv(1.6, 160, 0.002, 0.035)).toBeCloseTo(0.01);
  });
});
