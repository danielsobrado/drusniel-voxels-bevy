import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "../environment_query/types.js";
import {
  RiverCascadeParticleOverlay,
  cascadeParticleSignal,
} from "./riverCascadeParticleOverlay.js";
import { DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS } from "./riverCascadeParticlesRuntime.js";
import type { RiverDressingSample } from "./riverDressingSampleReader.js";
import type { WaterField, WaterFieldResult } from "./waterField.js";

const validMeta: EnvironmentQueryMeta = {
  source: "hydrology-cpu",
  revision: 1,
  valid: true,
  cellSizeM: 20,
};

function sample(overrides: Partial<RiverDressingSample> = {}): RiverDressingSample {
  return {
    waterY: 10,
    terrainY: 9,
    depth: 1,
    wetMask: 1,
    bodyKind: 3,
    shoreDistanceM: 5,
    flowX: 1,
    flowZ: 0,
    flowStrength: 0,
    bedDrop: 0,
    ...overrides,
  };
}

function fieldSample(overrides: Partial<WaterFieldResult> = {}): WaterFieldResult {
  return {
    waterY: 10,
    terrainY: 9,
    depth: 1,
    bodyMask: 1,
    bodyKind: 3,
    shoreDistance: 5,
    flow: { x: 1, z: 0, speed: 0, progress: 0, drop: 0 },
    ...overrides,
  };
}

function environmentQuery(valid = true): EnvironmentQuery {
  const meta = { ...validMeta, valid };
  return {
    surfaceHeightBestEffort: vi.fn((_x: number, _z: number, hint?: number) => ({
      height: 9,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    surfaceNormal: vi.fn((_x: number, _z: number, hint?: number) => ({
      x: 0,
      y: 1,
      z: 0,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    materialWeights: vi.fn((_x: number, _z: number, hint?: number) => ({
      grass: 1,
      rock: 0,
      sand: 0,
      snow: 0,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    water: vi.fn((_x: number, _z: number, hint?: number) => ({
      waterY: 10,
      carvedBedY: 9,
      depth: 0,
      wetMask: 0,
      shoreDistanceM: 5,
      bodyKind: 0,
      bodyId: null,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    river: vi.fn((_x: number, _z: number, hint?: number) => ({
      flowX: 1,
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

describe("cascade particle signal", () => {
  it("separates fast flat rapids from cascade drops", () => {
    const signal = cascadeParticleSignal(
      sample({ flowStrength: 3, bedDrop: 0.05 }),
      DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS,
    );

    expect(signal.rapid).toBeGreaterThan(0.8);
    expect(signal.cascade).toBe(0);
    expect(signal.foam).toBeGreaterThan(0.6);
  });

  it("uses high drop for cascade mist and splash signal", () => {
    const signal = cascadeParticleSignal(
      sample({ flowStrength: 0.4, bedDrop: 9 }),
      DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS,
    );

    expect(signal.cascade).toBeGreaterThan(0.8);
    expect(signal.foam).toBeGreaterThan(0.8);
  });

  it("does not emit from dry or invalid water samples", () => {
    const signal = cascadeParticleSignal(
      sample({ depth: 0, wetMask: 1, flowStrength: 9, bedDrop: 9 }),
      DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS,
    );

    expect(signal).toEqual({ cascade: 0, rapid: 0, foam: 0 });
  });

  it("budgets legacy field probes across frames", () => {
    const sampleForCellSize = vi.fn(() => fieldSample({ depth: 0, bodyMask: 0 }));
    const overlay = new RiverCascadeParticleOverlay(
      new THREE.Scene(),
      {
        sample: sampleForCellSize,
        sampleForCellSize,
      } as unknown as WaterField,
      { readEnvironmentQuery: () => null },
    );

    overlay.update(1, new THREE.Vector3());

    expect(sampleForCellSize.mock.calls.length).toBeGreaterThan(0);
    expect(sampleForCellSize.mock.calls.length).toBeLessThanOrEqual(16);
    expect(
      sampleForCellSize.mock.calls.every((call: unknown[]) => call[2] === 16),
    ).toBe(true);
    expect(overlay.getSamplingStats().fallbackSamples).toBeGreaterThan(0);
    overlay.dispose();
  });

  it("uses EnvironmentQuery with the requested hint and no legacy fallback", () => {
    const query = environmentQuery();
    const sampleForCellSize = vi.fn(() => {
      throw new Error("legacy field must not be sampled while the query is active");
    });
    const overlay = new RiverCascadeParticleOverlay(
      new THREE.Scene(),
      {
        sample: sampleForCellSize,
        sampleForCellSize,
      } as unknown as WaterField,
      {
        minimumSampleHintM: 20,
        readEnvironmentQuery: () => query,
      },
    );

    overlay.update(1, new THREE.Vector3());

    expect(query.water).toHaveBeenCalled();
    expect(query.river).toHaveBeenCalled();
    expect(
      (query.water as ReturnType<typeof vi.fn>).mock.calls.every(
        (call: unknown[]) => call[2] === 20,
      ),
    ).toBe(true);
    expect(sampleForCellSize).not.toHaveBeenCalled();
    expect(overlay.getSamplingStats().environmentSamples).toBeGreaterThan(0);
    expect(overlay.getSamplingStats().fallbackSamples).toBe(0);
    overlay.dispose();
  });

  it("fails closed when the active query is invalid", () => {
    const query = environmentQuery(false);
    const sampleForCellSize = vi.fn(() => fieldSample());
    const overlay = new RiverCascadeParticleOverlay(
      new THREE.Scene(),
      {
        sample: sampleForCellSize,
        sampleForCellSize,
      } as unknown as WaterField,
      { readEnvironmentQuery: () => query },
    );

    overlay.update(1, new THREE.Vector3());

    expect(sampleForCellSize).not.toHaveBeenCalled();
    expect(overlay.getSamplingStats().invalidSamples).toBeGreaterThan(0);
    overlay.dispose();
  });
});
