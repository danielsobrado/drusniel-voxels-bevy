import { describe, expect, it } from "vitest";
import {
  aerialPerspectiveReference,
  DEFAULT_POSTFX_ATMOSPHERE,
  exponentialFroxelSliceDistance,
  froxelSliceMarchSegment,
  henyeyGreenstein,
  parsePostFxFroxelDebugMode,
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
    ground_reference_m: -12
    ground_fog_density: 0.012
    altitude_fog_density: 0.003
    ground_falloff_m: 18
    altitude_falloff_m: 130
    sun_density_boost: 9
    ambient_density_floor: 2
    sun_shafts_strength: 0.7
    noise_strength: 2
`);
    expect(settings.hillaire.enabled).toBe(true);
    expect(settings.hillaire.mieG).toBe(0.95);
    expect(settings.hillaire.maxDistanceMeters).toBeCloseTo(9000);
    expect(settings.froxels.enabled).toBe(true);
    expect(settings.froxels.steps).toBe(48);
    expect(settings.froxels.groundReferenceHeightMeters).toBe(-12);
    expect(settings.froxels.sunDensityBoost).toBe(4);
    expect(settings.froxels.ambientDensityFloor).toBe(1);
    expect(settings.froxels.noiseStrength).toBe(1);
  });

  it("uses exponential froxel slice spacing", () => {
    expect(exponentialFroxelSliceDistance(2, 512, 0)).toBeCloseTo(2);
    expect(exponentialFroxelSliceDistance(2, 512, 1)).toBeCloseTo(512);
    expect(exponentialFroxelSliceDistance(2, 512, 0.5)).toBeCloseTo(32);
  });

  it("clips the last froxel slice at scene depth", () => {
    const segment = froxelSliceMarchSegment(2, 512, 2, 4, 40, 0.5);
    expect(segment.active).toBe(true);
    expect(segment.startMeters).toBeCloseTo(32);
    expect(segment.endMeters).toBeCloseTo(40);
    expect(segment.lengthMeters).toBeCloseTo(8);
    expect(segment.sampleMeters).toBeGreaterThan(segment.startMeters);
    expect(segment.sampleMeters).toBeLessThan(segment.endMeters);
  });

  it("skips froxel slices behind the scene depth", () => {
    const segment = froxelSliceMarchSegment(2, 512, 3, 4, 40);
    expect(segment.active).toBe(false);
    expect(segment.lengthMeters).toBe(0);
    expect(segment.endMeters).toBeCloseTo(segment.startMeters);
  });

  it("keeps Henyey-Greenstein finite and forward weighted", () => {
    const forward = henyeyGreenstein(1, 0.5);
    const backward = henyeyGreenstein(-1, 0.5);
    expect(forward).toBeGreaterThan(backward);
    expect(Number.isFinite(forward)).toBe(true);
  });

  it("keeps the near field almost untouched with per-meter extinction", () => {
    const { transmittance, color } = aerialPerspectiveReference(
      [0.3, 0.35, 0.25], 1000, 0, 0.2, DEFAULT_POSTFX_ATMOSPHERE.hillaire,
    );
    // The raised mie band (near->far terrain hand-off haze) costs up to ~8% in the
    // blue channel at 1 km; anything past 10% would be the old wash creeping back.
    for (let c = 0; c < 3; c++) {
      expect(transmittance[c]).toBeGreaterThan(0.90);
      expect(Math.abs(color[c] - [0.3, 0.35, 0.25][c])).toBeLessThan(0.05);
    }
  });

  it("attenuates blue faster than red so distant haze shifts blue", () => {
    const { transmittance } = aerialPerspectiveReference(
      [0.5, 0.5, 0.5], 8000, 0, 0.0, DEFAULT_POSTFX_ATMOSPHERE.hillaire,
    );
    expect(transmittance[0]).toBeGreaterThan(transmittance[1]);
    expect(transmittance[1]).toBeGreaterThan(transmittance[2]);
  });

  it("lightens dark terrain toward the horizon instead of crushing it", () => {
    const scene: [number, number, number] = [0.02, 0.03, 0.02];
    const { color } = aerialPerspectiveReference(
      scene, 12000, 0, 0.3, DEFAULT_POSTFX_ATMOSPHERE.hillaire,
    );
    for (let c = 0; c < 3; c++) {
      expect(color[c]).toBeGreaterThan(scene[c]);
      expect(color[c]).toBeLessThan(1.5);
    }
  });

  it("parses froxel debug view aliases", () => {
    expect(parsePostFxFroxelDebugMode("density")).toBe("density");
    expect(parsePostFxFroxelDebugMode("optical-depth")).toBe("density");
    expect(parsePostFxFroxelDebugMode("transmission")).toBe("transmittance");
    expect(parsePostFxFroxelDebugMode("in_scatter")).toBe("scatter");
    expect(parsePostFxFroxelDebugMode("unknown")).toBe("off");
  });
});
