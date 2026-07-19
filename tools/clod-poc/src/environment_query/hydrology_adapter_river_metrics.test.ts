import { describe, expect, it, vi } from "vitest";
import {
  createEnvironmentBatchOutput,
  sampleEnvironmentBatch,
} from "./batch.js";
import { ENVIRONMENT_QUERY_FIELD } from "./constants.js";
import { HydrologyEnvironmentQuery } from "./hydrology_adapter.js";
import type { HydrologySample } from "../water/hydrologyGrid.js";

function riverSample(overrides: Partial<HydrologySample> = {}): HydrologySample {
  return {
    terrainY: 10,
    waterY: 13,
    depth: 3,
    bodyMask: 1,
    lakeMask: 0,
    riverMask: 0.5,
    flowX: 3,
    flowZ: 4,
    flowStrength: 2,
    riverDepth: 3,
    waterYFar: 13,
    moisture: 1,
    bodyKind: 3,
    bodyId: 42,
    shoreDistance: 5,
    ...overrides,
  };
}

describe("HydrologyEnvironmentQuery river metrics", () => {
  it("uses one base sample and publishes authority-provided drop metrics", () => {
    const sampleAuthority = vi.fn(() => riverSample());
    const metricAuthority = vi.fn(() => ({
      flowX: 0.6,
      flowZ: 0.8,
      flowStrength: 1,
      bedDrop: 4.25,
    }));
    const query = new HydrologyEnvironmentQuery({
      hydrology: {
        sample: sampleAuthority,
        riverMetrics: metricAuthority,
      },
      nowMs: () => 0,
    });

    query.water(4, 8, 64);
    const river = query.river(4, 8, 64);

    expect(sampleAuthority).toHaveBeenCalledTimes(1);
    expect(metricAuthority).toHaveBeenCalledWith(4, 8, 64, expect.objectContaining({ bodyId: 42 }));
    expect(river.flowX).toBeCloseTo(0.6, 6);
    expect(river.flowZ).toBeCloseTo(0.8, 6);
    expect(river.flowStrength).toBeCloseTo(1, 6);
    expect(river.bedDrop).toBeCloseTo(4.25, 6);
  });

  it("normalizes and masks flow while keeping drop neutral when no metric authority exists", () => {
    const query = new HydrologyEnvironmentQuery({
      hydrology: { sample: () => riverSample() },
      nowMs: () => 0,
    });

    const river = query.river(1, 2, 16);

    expect(river.flowX).toBeCloseTo(0.6, 6);
    expect(river.flowZ).toBeCloseTo(0.8, 6);
    expect(river.flowStrength).toBeCloseTo(1, 6);
    expect(river.bedDrop).toBe(0);
  });

  it("writes the same metrics through the batch path and preserves every hint", () => {
    const hints: number[] = [];
    const metricAuthority = vi.fn((x: number, _z: number, hint: number) => {
      hints.push(hint);
      return {
        flowX: 1,
        flowZ: 0,
        flowStrength: x,
        bedDrop: x * 0.5,
      };
    });
    const query = new HydrologyEnvironmentQuery({
      hydrology: {
        sample: (x) => riverSample({ flowX: 1, flowZ: 0, flowStrength: x, riverMask: 1 }),
        riverMetrics: metricAuthority,
      },
      nowMs: () => 0,
    });
    const output = createEnvironmentBatchOutput(2);

    sampleEnvironmentBatch(
      query,
      { positionsXZ: new Float32Array([2, 3, 4, 5]), count: 2 },
      output,
      { fieldMask: ENVIRONMENT_QUERY_FIELD.river, sampleHintM: 48 },
    );

    expect(hints).toEqual([48, 48]);
    expect(Array.from(output.flowXZ)).toEqual([1, 0, 1, 0]);
    expect(Array.from(output.flowStrength)).toEqual([2, 4]);
    expect(Array.from(output.bedDrop)).toEqual([1, 2]);
  });

  it("does not request metrics for invalid samples", () => {
    const metricAuthority = vi.fn(() => ({ flowX: 1, flowZ: 0, flowStrength: 1, bedDrop: 1 }));
    const query = new HydrologyEnvironmentQuery({
      hydrology: {
        sample: () => riverSample({ waterY: Number.NaN }),
        riverMetrics: metricAuthority,
      },
      nowMs: () => 0,
    });

    const river = query.river(1, 2, 8);

    expect(metricAuthority).not.toHaveBeenCalled();
    expect(river.meta.valid).toBe(false);
    expect(river.bedDrop).toBe(0);
  });
});
