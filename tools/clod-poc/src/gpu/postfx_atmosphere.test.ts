import { describe, expect, it } from "vitest";
import {
  exponentialFroxelSliceDistance,
  henyeyGreenstein,
  parsePostFxAtmosphereSettings,
} from "./postfx_atmosphere.js";

describe("postfx atmosphere", () => {
  it("parses Hillaire and froxel settings", () => {
    const settings = parsePostFxAtmosphereSettings(`
postfx_atmosphere:
  hillaire:
    enabled: true
    strength: 1.5
    rayleigh_color: [0.4, 0.6, 1]
    mie_color: [1, 0.8, 0.6]
    rayleigh_scale_height_m: 7000
    mie_scale_height_m: 900
    rayleigh_extinction: 0.002
    mie_extinction: 0.004
    mie_g: 2
    max_distance_m: 9000
  froxels:
    enabled: true
    strength: 0.5
    max_distance_m: 480
    near_m: 2
    steps: 99
    ground_fog_density: 0.012
    altitude_fog_density: 0.003
    ground_falloff_m: 18
    altitude_falloff_m: 130
    sun_shafts_strength: 0.7
    noise_strength: 2
`);
    expect(settings.hillaire.enabled).toBe(true);
    expect(settings.hillaire.mieG).toBe(0.95);
    expect(settings.hillaire.maxDistanceMeters).toBeCloseTo(9000);
    expect(settings.froxels.enabled).toBe(true);
    expect(settings.froxels.steps).toBe(48);
    expect(settings.froxels.noiseStrength).toBe(1);
  });

  it("uses exponential froxel slice spacing", () => {
    expect(exponentialFroxelSliceDistance(2, 512, 0)).toBeCloseTo(2);
    expect(exponentialFroxelSliceDistance(2, 512, 1)).toBeCloseTo(512);
    expect(exponentialFroxelSliceDistance(2, 512, 0.5)).toBeCloseTo(32);
  });

  it("keeps Henyey-Greenstein finite and forward weighted", () => {
    const forward = henyeyGreenstein(1, 0.5);
    const backward = henyeyGreenstein(-1, 0.5);
    expect(forward).toBeGreaterThan(backward);
    expect(Number.isFinite(forward)).toBe(true);
  });
});
