import { describe, expect, it, vi } from "vitest";
import type { HydrologySample } from "../water/hydrologyGrid.js";
import { cascadeWhitewaterDrop } from "../water/water_field_helpers.js";
import { resolveHydrologyRiverMetrics } from "./hydrology_river_metrics.js";

function sample(overrides: Partial<HydrologySample> = {}): HydrologySample {
  return {
    terrainY: 7,
    waterY: 10,
    depth: 3,
    bodyMask: 1,
    lakeMask: 0,
    riverMask: 0.8,
    flowX: 3,
    flowZ: 4,
    flowStrength: 2,
    riverDepth: 3,
    waterYFar: 10,
    moisture: 1,
    bodyKind: 3,
    bodyId: 1,
    shoreDistance: 4,
    ...overrides,
  };
}

describe("hydrology river metrics", () => {
  it("normalizes flow, applies the river mask, and preserves the coarse hint for drop probes", () => {
    const calls: Array<[number, number, number]> = [];
    const source = {
      grid: { res: 5, worldCells: 16 },
      sample: vi.fn((x: number, z: number, hint: number) => {
        calls.push([x, z, hint]);
        return sample({ waterY: x < 10 ? 12 : 9, riverMask: 1 });
      }),
    };

    const metrics = resolveHydrologyRiverMetrics(source, sample(), 10, 20, 32);

    expect(metrics.flowX).toBeCloseTo(0.6, 6);
    expect(metrics.flowZ).toBeCloseTo(0.8, 6);
    expect(metrics.flowStrength).toBeCloseTo(1.6, 6);
    expect(metrics.bedDrop).toBeCloseTo(cascadeWhitewaterDrop(3, 1.6), 6);
    expect(calls).toEqual([
      [5.2, 13.6, 32],
      [14.8, 26.4, 32],
    ]);
  });

  it("avoids neighbor probes when flow or river coverage is ineffective", () => {
    const sampleNeighbor = vi.fn(() => sample());
    const source = { grid: { res: 5, worldCells: 16 }, sample: sampleNeighbor };

    expect(resolveHydrologyRiverMetrics(source, sample({ flowStrength: 0 }), 1, 2, 24)).toEqual({
      flowX: 0,
      flowZ: 0,
      flowStrength: 0,
      bedDrop: 0,
    });
    expect(resolveHydrologyRiverMetrics(source, sample({ riverMask: 0 }), 1, 2, 24)).toEqual({
      flowX: 0,
      flowZ: 0,
      flowStrength: 0,
      bedDrop: 0,
    });
    expect(sampleNeighbor).not.toHaveBeenCalled();
  });

  it("rejects a height difference when neither neighbor remains in the river corridor", () => {
    const source = {
      grid: { res: 5, worldCells: 16 },
      sample: vi.fn((x: number) => sample({ waterY: x < 10 ? 20 : 1, riverMask: 0 })),
    };

    const metrics = resolveHydrologyRiverMetrics(source, sample(), 10, 20, 16);

    expect(metrics.bedDrop).toBe(0);
    expect(source.sample).toHaveBeenCalledTimes(2);
  });
});
