import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "../environment_query/types.js";
import {
  CalmWaterRiseRingOverlay,
  calmWaterRiseRingSignal,
  resolveCalmWaterRiseRingSpec,
} from "./calmWaterRiseRingOverlay.js";
import { DEFAULT_CALM_WATER_RISE_RING_SETTINGS } from "./calmWaterRiseRingsRuntime.js";
import {
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_OCEAN,
  HYDROLOGY_BODY_RIVER,
} from "./hydrologyGrid.js";
import type { RiverDressingSample } from "./riverDressingSampleReader.js";
import type { WaterField, WaterFieldResult } from "./waterField.js";

const validMeta: EnvironmentQueryMeta = {
  source: "hydrology-cpu",
  revision: 1,
  valid: true,
  cellSizeM: 16,
};

function sample(overrides: Partial<RiverDressingSample> = {}): RiverDressingSample {
  return {
    waterY: 10,
    terrainY: 8,
    depth: 2,
    wetMask: 1,
    bodyKind: HYDROLOGY_BODY_LAKE,
    shoreDistanceM: 12,
    flowX: 0,
    flowZ: 0,
    flowStrength: 0,
    bedDrop: 0,
    ...overrides,
  };
}

function fieldSample(overrides: Partial<WaterFieldResult> = {}): WaterFieldResult {
  return {
    waterY: 10,
    terrainY: 8,
    depth: 2,
    bodyMask: 1,
    bodyKind: HYDROLOGY_BODY_LAKE,
    shoreDistance: 12,
    flow: { x: 0, z: 0, speed: 0, progress: 0, drop: 0 },
    ...overrides,
  };
}

function environmentQuery(valid = true): EnvironmentQuery {
  const meta = { ...validMeta, valid };
  return {
    surfaceHeightBestEffort: vi.fn((_x: number, _z: number, hint?: number) => ({
      height: 8,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    surfaceNormal: vi.fn((_x: number, _z: number, hint?: number) => ({
      x: 0,
      y: 1,
      z: 0,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    materialWeights: vi.fn((_x: number, _z: number, hint?: number) => ({
      grass: 0,
      rock: 0,
      sand: 1,
      snow: 0,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    water: vi.fn((_x: number, _z: number, hint?: number) => ({
      waterY: 10,
      carvedBedY: 8,
      depth: 2,
      wetMask: 1,
      shoreDistanceM: 12,
      bodyKind: HYDROLOGY_BODY_LAKE,
      bodyId: 5,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    river: vi.fn((_x: number, _z: number, hint?: number) => ({
      flowX: 0,
      flowZ: 0,
      flowStrength: 0,
      bedDrop: 0,
      rapidMask: 0,
      channelCenterWeight: 0,
      bankContactWeight: 0,
      gravelBarMask: 0,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    visibility: vi.fn((_x: number, _z: number, hint?: number) => ({
      sunVisibility: 1,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
  };
}

describe("calm-water rise rings", () => {
  it("accepts deep still-water interiors", () => {
    const signal = calmWaterRiseRingSignal(sample(), DEFAULT_CALM_WATER_RISE_RING_SETTINGS);

    expect(signal.value).toBeGreaterThan(0.8);
    expect(signal.calmFlow).toBe(1);
    expect(signal.calmBed).toBe(1);
  });

  it("rejects ocean surf, rapids, cascades, shore shallows, and dry water", () => {
    const settings = DEFAULT_CALM_WATER_RISE_RING_SETTINGS;

    expect(calmWaterRiseRingSignal(sample({ bodyKind: HYDROLOGY_BODY_OCEAN }), settings).value).toBe(0);
    expect(calmWaterRiseRingSignal(sample({ bodyKind: HYDROLOGY_BODY_RIVER, flowStrength: 2 }), settings).value).toBe(0);
    expect(calmWaterRiseRingSignal(sample({ bodyKind: HYDROLOGY_BODY_RIVER, bedDrop: 2 }), settings).value).toBe(0);
    expect(calmWaterRiseRingSignal(sample({ shoreDistanceM: 0.5 }), settings).value).toBe(0);
    expect(calmWaterRiseRingSignal(sample({ depth: 0, wetMask: 0 }), settings).value).toBe(0);
  });

  it("creates deterministic ring specifications", () => {
    const settings = { ...DEFAULT_CALM_WATER_RISE_RING_SETTINGS, strength: 3 };
    const water = sample();
    let selected: { cellX: number; cellZ: number } | null = null;
    for (let cellX = -8; cellX <= 8 && !selected; cellX += 1) {
      for (let cellZ = -8; cellZ <= 8; cellZ += 1) {
        if (resolveCalmWaterRiseRingSpec(cellX, cellZ, 4, 10, 20, water, settings)) {
          selected = { cellX, cellZ };
          break;
        }
      }
    }

    expect(selected).not.toBeNull();
    const first = resolveCalmWaterRiseRingSpec(
      selected!.cellX,
      selected!.cellZ,
      4,
      10,
      20,
      water,
      settings,
    );
    const repeated = resolveCalmWaterRiseRingSpec(
      selected!.cellX,
      selected!.cellZ,
      4,
      10,
      20,
      water,
      settings,
    );

    expect(first).not.toBeNull();
    expect(first).toEqual(repeated);
    expect(first!.life).toBeGreaterThan(0);
    expect(first!.endRadius).toBeGreaterThanOrEqual(first!.startRadius);
  });

  it("keeps legacy field sampling inside the configured frame budget", () => {
    const sampleForCellSize = vi.fn(() => fieldSample());
    const overlay = new CalmWaterRiseRingOverlay(
      new THREE.Scene(),
      {
        sample: sampleForCellSize,
        sampleForCellSize,
      } as unknown as WaterField,
      {
        readEnvironmentQuery: () => null,
        settings: {
          ...DEFAULT_CALM_WATER_RISE_RING_SETTINGS,
          cellsPerFrame: 5,
          scanIntervalS: 0.1,
          strength: 0,
        },
      },
    );

    overlay.update(1, new THREE.Vector3());

    expect(sampleForCellSize.mock.calls.length).toBeGreaterThan(0);
    expect(sampleForCellSize.mock.calls.length).toBeLessThanOrEqual(5);
    expect(sampleForCellSize.mock.calls.every((call: unknown[]) => call[2] === 16)).toBe(true);
    expect(overlay.getSamplingStats().fallbackSamples).toBeGreaterThan(0);
    overlay.dispose();
  });

  it("uses EnvironmentQuery with the requested hint and fails closed when invalid", () => {
    const query = environmentQuery();
    const legacy = vi.fn(() => {
      throw new Error("legacy field must not run while EnvironmentQuery is active");
    });
    const overlay = new CalmWaterRiseRingOverlay(
      new THREE.Scene(),
      { sample: legacy, sampleForCellSize: legacy } as unknown as WaterField,
      {
        minimumSampleHintM: 24,
        readEnvironmentQuery: () => query,
        settings: {
          ...DEFAULT_CALM_WATER_RISE_RING_SETTINGS,
          cellsPerFrame: 4,
          scanIntervalS: 0.1,
          strength: 0,
        },
      },
    );

    overlay.update(1, new THREE.Vector3());

    expect(query.water).toHaveBeenCalled();
    expect(query.river).toHaveBeenCalled();
    expect((query.water as ReturnType<typeof vi.fn>).mock.calls.every(
      (call: unknown[]) => call[2] === 24,
    )).toBe(true);
    expect(legacy).not.toHaveBeenCalled();
    overlay.dispose();

    const invalid = environmentQuery(false);
    const invalidOverlay = new CalmWaterRiseRingOverlay(
      new THREE.Scene(),
      { sample: legacy, sampleForCellSize: legacy } as unknown as WaterField,
      {
        readEnvironmentQuery: () => invalid,
        settings: {
          ...DEFAULT_CALM_WATER_RISE_RING_SETTINGS,
          cellsPerFrame: 3,
          scanIntervalS: 0.1,
        },
      },
    );
    invalidOverlay.update(1, new THREE.Vector3());
    expect(invalidOverlay.getSamplingStats().invalidSamples).toBeGreaterThan(0);
    expect(legacy).not.toHaveBeenCalled();
    invalidOverlay.dispose();
  });
});
