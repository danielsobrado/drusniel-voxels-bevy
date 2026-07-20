import { describe, expect, it, vi } from "vitest";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "../environment_query/types.js";
import type { WaterField, WaterFieldResult } from "./waterField.js";
import { RiverDressingSampleReader } from "./riverDressingSampleReader.js";

const validMeta: EnvironmentQueryMeta = {
  source: "hydrology-cpu",
  revision: 4,
  valid: true,
  cellSizeM: 24,
};

function waterFieldSample(overrides: Partial<WaterFieldResult> = {}): WaterFieldResult {
  return {
    waterY: 4,
    terrainY: 3,
    depth: 1,
    bodyMask: 1,
    bodyKind: 3,
    shoreDistance: 2,
    flow: { x: 1, z: 0, speed: 0.8, progress: 0, drop: 1.5 },
    ...overrides,
  };
}

function environmentQuery(meta: EnvironmentQueryMeta = validMeta): EnvironmentQuery {
  return {
    surfaceHeightBestEffort: vi.fn((_x: number, _z: number, hint?: number) => ({
      height: 3,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    surfaceNormal: vi.fn((_x: number, _z: number, hint?: number) => ({
      x: 0,
      y: 2,
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
      waterY: 4,
      carvedBedY: 3,
      depth: 1,
      wetMask: 1,
      shoreDistanceM: 2,
      bodyKind: 3,
      bodyId: 9,
      meta: { ...meta, cellSizeM: hint ?? 0 },
    })),
    river: vi.fn((_x: number, _z: number, hint?: number) => ({
      flowX: 1,
      flowZ: 0,
      flowStrength: 0.8,
      bedDrop: 1.5,
      rapidMask: 0,
      channelCenterWeight: 1,
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

function field(sample = waterFieldSample()): {
  readonly value: WaterField;
  readonly sampleForCellSize: ReturnType<typeof vi.fn>;
} {
  const sampleForCellSize = vi.fn(() => sample);
  return {
    value: {
      sample: vi.fn(() => sample),
      sampleForCellSize,
    } as unknown as WaterField,
    sampleForCellSize,
  };
}

describe("RiverDressingSampleReader", () => {
  it("uses the active query, preserves the coarse hint, and shares no hidden fallback", () => {
    const query = environmentQuery();
    const fallback = field();
    const reader = new RiverDressingSampleReader(fallback.value, {
      sampleHintM: 24,
      readEnvironmentQuery: () => query,
    });

    expect(reader.sampleRiver(3, 5)).toMatchObject({
      waterY: 4,
      terrainY: 3,
      flowStrength: 0.8,
      bedDrop: 1.5,
    });
    expect(reader.sampleWater(3, 5)).toMatchObject({ waterY: 4, depth: 1 });
    expect(reader.surfaceHeight(3, 5)).toBe(3);
    expect(reader.surfaceNormalY(3, 5, 1.2)).toBe(1);

    expect(query.water).toHaveBeenCalledWith(3, 5, 24);
    expect(query.river).toHaveBeenCalledWith(3, 5, 24);
    expect(query.surfaceHeightBestEffort).toHaveBeenCalledWith(3, 5, 24);
    expect(query.surfaceNormal).toHaveBeenCalledWith(3, 5, 24);
    expect(fallback.sampleForCellSize).not.toHaveBeenCalled();
    expect(reader.getStats()).toEqual({
      environmentSamples: 4,
      fallbackSamples: 0,
      invalidSamples: 0,
    });
  });

  it("fails closed when an active query is invalid", () => {
    const query = environmentQuery({ ...validMeta, valid: false });
    const fallback = field();
    const reader = new RiverDressingSampleReader(fallback.value, {
      readEnvironmentQuery: () => query,
    });

    expect(reader.sampleRiver(1, 2)).toBeNull();
    expect(reader.sampleWater(1, 2)).toBeNull();
    expect(reader.surfaceHeight(1, 2)).toBeNull();
    expect(reader.surfaceNormalY(1, 2, 1)).toBeNull();
    expect(fallback.sampleForCellSize).not.toHaveBeenCalled();
    expect(reader.getStats()).toEqual({
      environmentSamples: 4,
      fallbackSamples: 0,
      invalidSamples: 4,
    });
  });

  it("uses the legacy field only when no active query exists", () => {
    const fallback = field();
    const reader = new RiverDressingSampleReader(fallback.value, {
      sampleHintM: 20,
      readEnvironmentQuery: () => null,
    });

    expect(reader.sampleRiver(1, 2)).toMatchObject({ flowStrength: 0.8, bedDrop: 1.5 });
    expect(reader.sampleWater(1, 2)).toMatchObject({ waterY: 4, wetMask: 1 });
    expect(reader.surfaceHeight(1, 2)).toBe(3);
    expect(reader.surfaceNormalY(1, 2, 1)).toBe(1);

    expect(fallback.sampleForCellSize).toHaveBeenCalled();
    expect(
      fallback.sampleForCellSize.mock.calls.every((call: unknown[]) => call[2] === 20),
    ).toBe(true);
    expect(reader.getStats()).toEqual({
      environmentSamples: 0,
      fallbackSamples: 4,
      invalidSamples: 0,
    });
  });
});
