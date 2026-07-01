import { describe, expect, it } from "vitest";
import {
  autoExposureWeightTotal,
  centerMeterWeight,
  parsePostFxAutoExposureSettings,
} from "./postfx_auto_exposure.js";

describe("postfx auto exposure", () => {
  it("parses and clamps yaml settings", () => {
    const settings = parsePostFxAutoExposureSettings(`
postfx_auto_exposure:
  enabled: true
  lock: true
  samples_per_axis: 64
  target_luminance: 0.12
  min_exposure: 0.2
  max_exposure: 3.5
  adaptation_rate: 2
  center_weight_strength: 2
`);
    expect(settings.enabled).toBe(true);
    expect(settings.lock).toBe(true);
    expect(settings.samplesPerAxis).toBe(24);
    expect(settings.targetLuminance).toBeCloseTo(0.12);
    expect(settings.minExposure).toBeCloseTo(0.2);
    expect(settings.maxExposure).toBeCloseTo(3.5);
    expect(settings.adaptationRate).toBe(1);
    expect(settings.centerWeightStrength).toBe(0.95);
  });

  it("keeps center metering stronger than edge metering", () => {
    const center = centerMeterWeight(0.5, 0.5, 0.55);
    const corner = centerMeterWeight(0.0, 0.0, 0.55);
    expect(center).toBeGreaterThan(corner);
    expect(corner).toBeGreaterThan(0);
  });

  it("computes a positive deterministic weight total", () => {
    expect(autoExposureWeightTotal(12, 0.55)).toBeCloseTo(autoExposureWeightTotal(12, 0.55));
    expect(autoExposureWeightTotal(12, 0.55)).toBeGreaterThan(0);
  });
});
