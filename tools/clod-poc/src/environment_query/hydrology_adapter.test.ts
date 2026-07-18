import { describe, expect, it } from "vitest";
import {
  createEnvironmentBatchOutput,
  environmentQuerySourceIndex,
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
    riverMask: 0.8,
    flowX: 0.6,
    flowZ: 0.8,
    flowStrength: 2.5,
    riverDepth: 3,
    waterYFar: 13,
    moisture: 1,
    bodyKind: 3,
    bodyId: 42,
    shoreDistance: 5,
    ...overrides,
  };
}

describe("HydrologyEnvironmentQuery", () => {
  it("preserves the sample hint and reuses one hydrology sample across scalar fields", () => {
    const calls: Array<[number, number, number]> = [];
    const query = new HydrologyEnvironmentQuery({
      hydrology: {
        sample: (x, z, hint) => {
          calls.push([x, z, hint]);
          return riverSample();
        },
      },
      nowMs: () => 0,
    });

    const surface = query.surfaceHeightBestEffort(4, 8, 64);
    const water = query.water(4, 8, 64);
    const river = query.river(4, 8, 64);

    expect(calls).toEqual([[4, 8, 64]]);
    expect(surface.height).toBe(10);
    expect(water.bodyId).toBe(42);
    expect(water.carvedBedY).toBe(10);
    expect(river.flowX).toBeCloseTo(0.6, 6);
    expect(river.channelCenterWeight).toBeCloseTo(0.8, 6);
    expect(river.bedDrop).toBe(0);
    expect(river.rapidMask).toBe(0);
    expect(river.gravelBarMask).toBe(0);

    const diagnostics = query.diagnostics.snapshot();
    expect(diagnostics.scalarCalls).toBe(3);
    expect(diagnostics.bySource["hydrology-cpu"]).toBe(3);
    expect(diagnostics.minHintM).toBe(64);
    expect(diagnostics.maxHintM).toBe(64);
  });

  it("invalidates the scalar cache when the authority revision changes", () => {
    let revision = 1;
    let samples = 0;
    const query = new HydrologyEnvironmentQuery({
      hydrology: {
        sample: () => {
          samples += 1;
          return riverSample({ waterY: 10 + revision });
        },
        revision: () => revision,
      },
      nowMs: () => 0,
    });

    expect(query.water(1, 2, 16).waterY).toBe(11);
    revision = 2;
    expect(query.water(1, 2, 16).waterY).toBe(12);
    expect(samples).toBe(2);
  });

  it("maps dry body ids to null without marking the sample invalid", () => {
    const query = new HydrologyEnvironmentQuery({
      hydrology: {
        sample: () => riverSample({ bodyMask: 0, bodyKind: 0, bodyId: 0, depth: 0 }),
      },
      nowMs: () => 0,
    });

    const water = query.water(0, 0, 4);
    expect(water.bodyId).toBe(null);
    expect(water.meta.valid).toBe(true);
  });

  it("samples hydrology once per batch position for all hydrology-backed fields", () => {
    const hints: number[] = [];
    const query = new HydrologyEnvironmentQuery({
      hydrology: {
        sample: (x, _z, hint) => {
          hints.push(hint);
          return riverSample({ terrainY: x, waterY: x + 2, bodyId: x + 1 });
        },
      },
      nowMs: () => 0,
    });
    const output = createEnvironmentBatchOutput(2);
    const fieldMask = ENVIRONMENT_QUERY_FIELD.surface
      | ENVIRONMENT_QUERY_FIELD.water
      | ENVIRONMENT_QUERY_FIELD.river
      | ENVIRONMENT_QUERY_FIELD.visibility;

    sampleEnvironmentBatch(
      query,
      { positionsXZ: new Float32Array([4, 5, 8, 9]), count: 2 },
      output,
      { fieldMask, sampleHintM: 48 },
    );

    expect(hints).toEqual([48, 48]);
    expect(output.count).toBe(2);
    expect(Array.from(output.surfaceHeight)).toEqual([4, 8]);
    expect(Array.from(output.waterY)).toEqual([6, 10]);
    expect(Array.from(output.bodyId)).toEqual([5, 9]);
    expect(output.meta.water.source[0]).toBe(environmentQuerySourceIndex("hydrology-cpu"));
    expect(output.meta.visibility.source[0]).toBe(environmentQuerySourceIndex("fallback"));
    expect(output.meta.visibility.valid[0]).toBe(0);

    const diagnostics = query.diagnostics.snapshot();
    expect(diagnostics.batchCalls).toBe(1);
    expect(diagnostics.samples).toBe(2);
    expect(diagnostics.byField.surface).toBe(2);
    expect(diagnostics.byField.water).toBe(2);
    expect(diagnostics.byField.river).toBe(2);
    expect(diagnostics.byField.visibility).toBe(2);
    expect(diagnostics.bySource["hydrology-cpu"]).toBe(2);
    expect(diagnostics.bySource.fallback).toBe(2);
  });
});
