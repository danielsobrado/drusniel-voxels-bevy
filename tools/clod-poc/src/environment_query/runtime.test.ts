import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEnvironmentBatchOutput,
  sampleEnvironmentBatch,
} from "./batch.js";
import { ENVIRONMENT_QUERY_FIELD } from "./constants.js";
import {
  bindActiveEnvironmentQuery,
  createEnvironmentQueryRuntimeFromAuthorities,
  readActiveEnvironmentQuery,
} from "./runtime.js";
import { HYDROLOGY_BODY_RIVER, type HydrologySample } from "../water/hydrologyGrid.js";

const hydrologySample: HydrologySample = {
  terrainY: 10,
  waterY: 11,
  depth: 1,
  bodyMask: 1,
  lakeMask: 0,
  riverMask: 1,
  flowX: 0.8,
  flowZ: 0.2,
  flowStrength: 0.6,
  riverDepth: 1,
  waterYFar: 11,
  moisture: 0.9,
  bodyKind: HYDROLOGY_BODY_RIVER,
  bodyId: 42,
  shoreDistance: 3,
};

afterEach(() => {
  bindActiveEnvironmentQuery(null);
});

describe("composed environment query runtime", () => {
  it("routes each field to its canonical authority", () => {
    const hydrology = {
      sample: vi.fn(() => hydrologySample),
      revision: vi.fn(() => 5),
    };
    const terrain = {
      sample: vi.fn(() => ({
        height: 12,
        normalX: 0,
        normalY: 2,
        normalZ: 0,
        grass: 2,
        rock: 1,
        sand: 1,
        snow: 0,
        valid: true,
        revision: 7,
      })),
      revision: vi.fn(() => 7),
    };
    const visibility = {
      sample: vi.fn(() => ({
        visibility: 0.35,
        valid: true,
        revision: 9,
        cellSizeM: 16,
      })),
    };
    const runtime = createEnvironmentQueryRuntimeFromAuthorities({ hydrology, terrain, visibility });

    expect(runtime.query.surfaceHeightBestEffort(4, 6, 16)).toEqual({
      height: 12,
      meta: { source: "live-terrain", revision: 7, valid: true, cellSizeM: 16 },
    });
    expect(runtime.query.surfaceNormal(4, 6, 16)).toMatchObject({
      x: 0,
      y: 1,
      z: 0,
      meta: { source: "live-terrain", revision: 7, valid: true, cellSizeM: 16 },
    });
    expect(runtime.query.materialWeights(4, 6, 16)).toMatchObject({
      grass: 0.5,
      rock: 0.25,
      sand: 0.25,
      snow: 0,
      meta: { source: "live-terrain", revision: 7, valid: true, cellSizeM: 16 },
    });
    expect(runtime.query.water(4, 6, 16)).toMatchObject({
      depth: 1,
      bodyKind: HYDROLOGY_BODY_RIVER,
      bodyId: 42,
      meta: { source: "hydrology-cpu", revision: 5, valid: true, cellSizeM: 16 },
    });
    expect(runtime.query.river(4, 6, 16)).toMatchObject({
      flowStrength: 0.6,
      meta: { source: "hydrology-cpu", revision: 5, valid: true, cellSizeM: 16 },
    });
    expect(runtime.query.visibility(4, 6, 16)).toEqual({
      sunVisibility: 0.35,
      meta: { source: "sun-visibility-cache", revision: 9, valid: true, cellSizeM: 16 },
    });

    expect(terrain.sample).toHaveBeenCalledTimes(1);
    expect(hydrology.sample).toHaveBeenCalledTimes(1);
    expect(visibility.sample).toHaveBeenCalledTimes(1);
    expect(readActiveEnvironmentQuery()).toBe(runtime.query);

    runtime.dispose();
    expect(readActiveEnvironmentQuery()).toBeNull();
  });

  it("preserves field masks and sample hints through one composed batch", () => {
    const hydrology = {
      sample: vi.fn(() => hydrologySample),
      revision: () => 5,
    };
    const terrain = {
      sample: vi.fn(() => ({
        height: 12,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        grass: 1,
        rock: 0,
        sand: 0,
        snow: 0,
        valid: true,
        revision: 7,
      })),
      revision: () => 7,
    };
    const visibility = {
      sample: vi.fn(() => ({ visibility: 0.5, valid: true, revision: 9, cellSizeM: 32 })),
    };
    const runtime = createEnvironmentQueryRuntimeFromAuthorities({ hydrology, terrain, visibility });
    const output = createEnvironmentBatchOutput(2);

    sampleEnvironmentBatch(
      runtime.query,
      { positionsXZ: new Float32Array([1, 2, 3, 4]), count: 2 },
      output,
      {
        fieldMask: ENVIRONMENT_QUERY_FIELD.normal
          | ENVIRONMENT_QUERY_FIELD.water
          | ENVIRONMENT_QUERY_FIELD.visibility,
        sampleHintM: 32,
      },
    );

    expect(terrain.sample).toHaveBeenCalledTimes(2);
    expect(hydrology.sample).toHaveBeenCalledTimes(2);
    expect(visibility.sample).toHaveBeenCalledTimes(2);
    expect(Array.from(output.normalXYZ)).toEqual([0, 1, 0, 0, 1, 0]);
    expect(Array.from(output.waterDepth)).toEqual([1, 1]);
    expect(Array.from(output.sunVisibility)).toEqual([0.5, 0.5]);
    expect(Array.from(output.meta.normal.cellSizeM)).toEqual([32, 32]);
    expect(Array.from(output.meta.water.cellSizeM)).toEqual([32, 32]);
    expect(Array.from(output.meta.visibility.cellSizeM)).toEqual([32, 32]);
    expect(Array.from(output.materialWeights)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);

    runtime.dispose();
  });

  it("does not clear a newer active query when an older runtime is disposed", () => {
    const authorities = () => ({
      hydrology: { sample: () => hydrologySample, revision: () => 1 },
      terrain: {
        sample: () => ({
          height: 1,
          normalX: 0,
          normalY: 1,
          normalZ: 0,
          grass: 1,
          rock: 0,
          sand: 0,
          snow: 0,
          valid: true,
          revision: 1,
        }),
        revision: () => 1,
      },
      visibility: { sample: () => ({ visibility: 1, valid: true, revision: 1, cellSizeM: 8 }) },
    });
    const first = createEnvironmentQueryRuntimeFromAuthorities(authorities());
    const second = createEnvironmentQueryRuntimeFromAuthorities(authorities());

    first.dispose();
    expect(readActiveEnvironmentQuery()).toBe(second.query);
    second.dispose();
    expect(readActiveEnvironmentQuery()).toBeNull();
  });
});
