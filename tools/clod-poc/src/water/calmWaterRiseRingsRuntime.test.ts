import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALM_WATER_RISE_RING_SETTINGS,
  parseCalmWaterRiseRingSettings,
  sanitizeCalmWaterRiseRingSettings,
} from "./calmWaterRiseRingsRuntime.js";

describe("calm-water rise-ring settings", () => {
  it("loads safe YAML-owned defaults", () => {
    const settings = DEFAULT_CALM_WATER_RISE_RING_SETTINGS;

    expect(settings.enabled).toBe(true);
    expect(settings.scanGrid % 2).toBe(1);
    expect(settings.cellsPerFrame).toBeGreaterThan(0);
    expect(settings.maxRings).toBeGreaterThan(0);
    expect(settings.lifeMaxS).toBeGreaterThanOrEqual(settings.lifeMinS);
    expect(settings.endRadiusM).toBeGreaterThanOrEqual(settings.startRadiusM);
  });

  it("parses the rise-ring YAML section", () => {
    const settings = parseCalmWaterRiseRingSettings(`
river_ambience:
  calm_water_rise_rings:
    enabled: false
    strength: 0.8
    spawn_radius_m: 50
    scan_interval_s: 0.6
    scan_grid: 17
    cell_spacing_m: 6
    cells_per_frame: 7
    max_emitters_per_scan: 5
    max_rings: 40
    segments_per_ring: 20
    minimum_depth_m: 0.5
    minimum_shore_distance_m: 4
    maximum_flow_strength: 0.25
    maximum_bed_drop_m: 0.12
    life_min_s: 1.4
    life_max_s: 2.4
    start_radius_m: 0.1
    end_radius_m: 1.1
`);

    expect(settings).toEqual({
      enabled: false,
      strength: 0.8,
      spawnRadiusM: 50,
      scanIntervalS: 0.6,
      scanGrid: 17,
      cellSpacingM: 6,
      cellsPerFrame: 7,
      maxEmittersPerScan: 5,
      maxRings: 40,
      segmentsPerRing: 20,
      minimumDepthM: 0.5,
      minimumShoreDistanceM: 4,
      maximumFlowStrength: 0.25,
      maximumBedDropM: 0.12,
      lifeMinS: 1.4,
      lifeMaxS: 2.4,
      startRadiusM: 0.1,
      endRadiusM: 1.1,
    });
  });

  it("clamps budgets and keeps the grid odd", () => {
    const settings = sanitizeCalmWaterRiseRingSettings({
      ...DEFAULT_CALM_WATER_RISE_RING_SETTINGS,
      scanGrid: 32,
      cellsPerFrame: 100,
      maxEmittersPerScan: 100,
      maxRings: 1000,
      segmentsPerRing: 2,
      lifeMinS: 5,
      lifeMaxS: 1,
      startRadiusM: 2,
      endRadiusM: 0.1,
    });

    expect(settings.scanGrid).toBe(33);
    expect(settings.cellsPerFrame).toBe(32);
    expect(settings.maxEmittersPerScan).toBe(24);
    expect(settings.maxRings).toBe(192);
    expect(settings.segmentsPerRing).toBe(8);
    expect(settings.lifeMaxS).toBe(settings.lifeMinS);
    expect(settings.endRadiusM).toBe(settings.startRadiusM);
  });
});
