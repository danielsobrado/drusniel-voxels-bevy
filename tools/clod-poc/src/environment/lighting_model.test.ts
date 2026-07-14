import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  DEFAULT_ENVIRONMENT_SETTINGS,
} from "./environment.js";
import {
  deriveEnvironmentLighting,
  environmentSunTransmittance,
  parseEnvironmentLightingModel,
} from "./lighting_model.js";

function luminance(color: THREE.Color): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

describe("environment lighting model", () => {
  it("keeps direct noon light dominant over the ambient floor", () => {
    const lighting = deriveEnvironmentLighting(
      new THREE.Vector3(0.2, 0.85, 0.3).normalize(),
      DEFAULT_ENVIRONMENT_SETTINGS,
      DEFAULT_ENVIRONMENT_COLORS,
    );
    expect(luminance(lighting.sunColor)).toBeGreaterThan(luminance(lighting.skyLight) * 12);
    expect(lighting.ambientFloor ?? 1).toBeLessThan(0.04);
  });

  it("warms low sun through atmospheric transmittance", () => {
    const noon = environmentSunTransmittance(new THREE.Vector3(0, 1, 0));
    const low = environmentSunTransmittance(new THREE.Vector3(1, 0.05, 0).normalize());
    expect(low.r / Math.max(low.b, 0.0001)).toBeGreaterThan(noon.r / Math.max(noon.b, 0.0001));
  });

  it("clamps malformed YAML to a stable model", () => {
    const parsed = parseEnvironmentLightingModel(`
environment_lighting:
  direct_scale: -5
  ambient_floor: -1
  horizon_fade_start: 0.2
  horizon_fade_end: 0.1
  extinction_rgb: [0.1, 0.2, 0.3]
`);
    expect(parsed.directScale).toBe(0);
    expect(parsed.ambientFloor).toBe(0);
    expect(parsed.horizonFadeEnd).toBeGreaterThan(parsed.horizonFadeStart);
    expect(parsed.extinctionRgb).toEqual([0.1, 0.2, 0.3]);
  });
});
