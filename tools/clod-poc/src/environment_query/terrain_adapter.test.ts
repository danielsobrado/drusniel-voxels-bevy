import { describe, expect, it, vi } from "vitest";
import {
  createEnvironmentBatchOutput,
  sampleEnvironmentBatch,
  type EnvironmentBatchInput,
  type EnvironmentBatchOutput,
  type EnvironmentBatchSampler,
  type ResolvedEnvironmentBatchOptions,
} from "./batch.js";
import { ENVIRONMENT_QUERY_FIELD } from "./constants.js";
import { TerrainEnvironmentQuery, type TerrainEnvironmentAuthority } from "./terrain_adapter.js";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "./types.js";

const fallbackMeta: EnvironmentQueryMeta = {
  source: "fallback",
  revision: 0,
  valid: false,
  cellSizeM: 8,
};

describe("terrain environment query", () => {
  it("reuses one scalar authority sample for height, normal, and material fields", () => {
    const base = makeBase();
    const terrain = makeTerrainAuthority();
    const query = new TerrainEnvironmentQuery({ base, terrain });

    expect(query.surfaceHeightBestEffort(4, 6, 16)).toEqual({
      height: 32,
      meta: { source: "live-terrain", revision: 7, valid: true, cellSizeM: 16 },
    });
    expect(query.surfaceNormal(4, 6, 16)).toEqual({
      x: 0,
      y: 1,
      z: 0,
      meta: { source: "live-terrain", revision: 7, valid: true, cellSizeM: 16 },
    });
    expect(query.materialWeights(4, 6, 16)).toEqual({
      grass: 0.5,
      rock: 0.25,
      sand: 0.25,
      snow: 0,
      meta: { source: "live-terrain", revision: 7, valid: true, cellSizeM: 16 },
    });
    expect(terrain.sample).toHaveBeenCalledTimes(1);
    expect(terrain.sample).toHaveBeenCalledWith(4, 6, 16);
    expect(base.surfaceHeightBestEffort).not.toHaveBeenCalled();
    expect(base.surfaceNormal).not.toHaveBeenCalled();
    expect(base.materialWeights).not.toHaveBeenCalled();
  });

  it("normalizes valid values and fails closed for malformed terrain samples", () => {
    const query = new TerrainEnvironmentQuery({
      base: makeBase(),
      terrain: {
        sample: vi.fn(() => ({
          height: 4,
          normalX: 0,
          normalY: 4,
          normalZ: 0,
          grass: 2,
          rock: 1,
          sand: 1,
          snow: 0,
          valid: true,
          revision: 2,
        })),
      },
    });

    expect(query.surfaceNormal(1, 2, 8).y).toBe(1);
    expect(query.materialWeights(1, 2, 8)).toMatchObject({ grass: 0.5, rock: 0.25, sand: 0.25, snow: 0 });

    const invalid = new TerrainEnvironmentQuery({
      base: makeBase(),
      terrain: {
        sample: () => ({
          height: Number.NaN,
          normalX: Number.NaN,
          normalY: 0,
          normalZ: 0,
          grass: Number.NaN,
          rock: 0,
          sand: 0,
          snow: 0,
          valid: false,
          revision: 3,
        }),
      },
    });
    expect(invalid.surfaceHeightBestEffort(0, 0, 8).height).toBeNull();
    expect(invalid.surfaceNormal(0, 0, 8)).toMatchObject({ x: 0, y: 1, z: 0, meta: { valid: false } });
    expect(invalid.materialWeights(0, 0, 8)).toMatchObject({
      grass: 0,
      rock: 0,
      sand: 0,
      snow: 0,
      meta: { valid: false },
    });
  });

  it("samples terrain once per batch point and delegates only non-terrain fields", () => {
    const base = makeBase();
    const terrain = makeTerrainAuthority();
    const query = new TerrainEnvironmentQuery({ base, terrain });
    const output = createEnvironmentBatchOutput(2);

    sampleEnvironmentBatch(
      query,
      { positionsXZ: new Float32Array([1, 2, 3, 4]), count: 2 },
      output,
      {
        fieldMask: ENVIRONMENT_QUERY_FIELD.surface
          | ENVIRONMENT_QUERY_FIELD.normal
          | ENVIRONMENT_QUERY_FIELD.material
          | ENVIRONMENT_QUERY_FIELD.water,
        sampleHintM: 32,
      },
    );

    expect(terrain.sample).toHaveBeenCalledTimes(2);
    expect(terrain.sample).toHaveBeenNthCalledWith(1, 1, 2, 32);
    expect(terrain.sample).toHaveBeenNthCalledWith(2, 3, 4, 32);
    expect(base.sampleBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(base.sampleBatch).mock.calls[0]?.[2].fieldMask).toBe(ENVIRONMENT_QUERY_FIELD.water);
    expect(Array.from(output.surfaceHeight)).toEqual([32, 32]);
    expect(Array.from(output.normalXYZ)).toEqual([0, 1, 0, 0, 1, 0]);
    expect(Array.from(output.materialWeights)).toEqual([0.5, 0.25, 0.25, 0, 0.5, 0.25, 0.25, 0]);
    expect(Array.from(output.waterDepth)).toEqual([0.5, 0.5]);
    expect(Array.from(output.meta.surface.valid)).toEqual([1, 1]);
    expect(Array.from(output.meta.normal.valid)).toEqual([1, 1]);
    expect(Array.from(output.meta.material.valid)).toEqual([1, 1]);
  });

  it("delegates water, river, and visibility without changing ownership", () => {
    const base = makeBase();
    const query = new TerrainEnvironmentQuery({ base, terrain: makeTerrainAuthority() });

    query.water(1, 2, 4);
    query.river(1, 2, 4);
    query.visibility(1, 2, 4);

    expect(base.water).toHaveBeenCalledWith(1, 2, 4);
    expect(base.river).toHaveBeenCalledWith(1, 2, 4);
    expect(base.visibility).toHaveBeenCalledWith(1, 2, 4);
  });
});

function makeTerrainAuthority(): TerrainEnvironmentAuthority & { sample: ReturnType<typeof vi.fn> } {
  return {
    sample: vi.fn(() => ({
      height: 32,
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
  };
}

function makeBase(): EnvironmentQuery & EnvironmentBatchSampler {
  return {
    surfaceHeightBestEffort: vi.fn(() => ({ height: null, meta: fallbackMeta })),
    surfaceNormal: vi.fn(() => ({ x: 0, y: 1, z: 0, meta: fallbackMeta })),
    materialWeights: vi.fn(() => ({ grass: 0, rock: 0, sand: 0, snow: 0, meta: fallbackMeta })),
    water: vi.fn(() => ({
      waterY: 2,
      carvedBedY: 1.5,
      depth: 0.5,
      wetMask: 1,
      shoreDistanceM: 3,
      bodyKind: 3,
      bodyId: 1,
      meta: { ...fallbackMeta, source: "hydrology-cpu", valid: true },
    })),
    river: vi.fn(() => ({
      flowX: 1,
      flowZ: 0,
      flowStrength: 0.4,
      bedDrop: 0.2,
      rapidMask: 0,
      channelCenterWeight: 1,
      bankContactWeight: 0,
      gravelBarMask: 0,
      meta: { ...fallbackMeta, source: "hydrology-cpu", valid: true },
    })),
    visibility: vi.fn(() => ({ sunVisibility: 1, meta: fallbackMeta })),
    sampleBatch: vi.fn((
      input: EnvironmentBatchInput,
      output: EnvironmentBatchOutput,
      options: ResolvedEnvironmentBatchOptions,
    ) => {
      if ((options.fieldMask & ENVIRONMENT_QUERY_FIELD.water) === 0) return;
      for (let index = 0; index < input.count; index += 1) {
        output.waterY[index] = 2;
        output.carvedBedY[index] = 1.5;
        output.waterDepth[index] = 0.5;
        output.wetMask[index] = 1;
        output.shoreDistanceM[index] = 3;
        output.bodyKind[index] = 3;
        output.bodyId[index] = 1;
        output.meta.water.valid[index] = 1;
        output.meta.water.cellSizeM[index] = options.sampleHintM;
      }
    }),
  };
}
