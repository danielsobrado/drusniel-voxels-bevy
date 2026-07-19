import { describe, expect, it, vi } from "vitest";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import type {
  EnvironmentBatchInput,
  EnvironmentBatchOutput,
  EnvironmentBatchSampler,
  ResolvedEnvironmentBatchOptions,
} from "../environment_query/batch.js";
import { ENVIRONMENT_QUERY_FIELD } from "../environment_query/constants.js";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "../environment_query/types.js";
import { HYDROLOGY_BODY_RIVER } from "../water/hydrologyGrid.js";
import {
  createEnvironmentalMaskBatchBuffers,
  evaluateEnvironmentalMaskBatch,
  unpackEnvironmentalMaskValidity,
} from "./environment_mask_batch.js";
import { cloneEnvironmentalMaskSettings } from "./environment_mask_config.js";

const biome: BiomeVisualState = {
  enabled: true,
  seasonT: 0,
  green: 1,
  autumn: 0,
  bloom: 0,
  snowlineM: 80,
  glacialMurkiness: 0.8,
  morningMist: 0.7,
  pollenAmount: 0.3,
  frostAmount: 0.4,
  wetness: 0.6,
};

describe("environmental mask batch", () => {
  it("fills caller-owned buffers with interleaved positions and preserves the hint", () => {
    const query = makeQuery();
    const output = createEnvironmentalMaskBatchBuffers(2);
    const returned = evaluateEnvironmentalMaskBatch({
      query,
      settings: cloneEnvironmentalMaskSettings(),
      biome,
      positions: new Float32Array([99, 10, 20, 7, 99, 30, 40, 7]),
      count: 2,
      positionStride: 4,
      positionOffset: 1,
      hintM: 32,
      output,
    });

    expect(returned).toBe(output);
    expect(output.riverCobble[0]).toBeGreaterThan(0);
    expect(output.riverCobble[1]).toBeGreaterThan(0);
    expect(query.water).toHaveBeenNthCalledWith(1, 10, 20, 32);
    expect(query.water).toHaveBeenNthCalledWith(2, 30, 40, 32);
    expect(unpackEnvironmentalMaskValidity(output.validity[0])).toEqual({
      water: true,
      river: true,
      normal: true,
      visibility: true,
    });
  });

  it("uses one authority batch and preserves scalar mask parity", () => {
    const positions = new Float32Array([99, 10, 20, 7, 99, 30, 40, 7]);
    const settings = cloneEnvironmentalMaskSettings();
    const scalarQuery = makeQuery();
    const batchQuery = makeBatchQuery();
    const scalarOutput = createEnvironmentalMaskBatchBuffers(2);
    const batchOutput = createEnvironmentalMaskBatchBuffers(2);

    evaluateEnvironmentalMaskBatch({
      query: scalarQuery,
      settings,
      biome,
      positions,
      count: 2,
      positionStride: 4,
      positionOffset: 1,
      hintM: 32,
      output: scalarOutput,
    });
    evaluateEnvironmentalMaskBatch({
      query: batchQuery,
      settings,
      biome,
      positions,
      count: 2,
      positionStride: 4,
      positionOffset: 1,
      hintM: 32,
      output: batchOutput,
    });

    expect(batchQuery.sampleBatch).toHaveBeenCalledTimes(1);
    expect(batchQuery.water).not.toHaveBeenCalled();
    expect(batchQuery.river).not.toHaveBeenCalled();
    expect(batchQuery.surfaceNormal).not.toHaveBeenCalled();
    expect(batchQuery.visibility).not.toHaveBeenCalled();
    const options = vi.mocked(batchQuery.sampleBatch).mock.calls[0]?.[2];
    expect(options).toEqual({
      fieldMask: ENVIRONMENT_QUERY_FIELD.water
        | ENVIRONMENT_QUERY_FIELD.river
        | ENVIRONMENT_QUERY_FIELD.normal
        | ENVIRONMENT_QUERY_FIELD.visibility,
      sampleHintM: 32,
    });
    expect(Array.from(batchOutput.riverCobble)).toEqual(Array.from(scalarOutput.riverCobble));
    expect(Array.from(batchOutput.riverMist)).toEqual(Array.from(scalarOutput.riverMist));
    expect(Array.from(batchOutput.rapidSplash)).toEqual(Array.from(scalarOutput.rapidSplash));
    expect(Array.from(batchOutput.sunbeamMote)).toEqual(Array.from(scalarOutput.sunbeamMote));
    expect(Array.from(batchOutput.calmPool)).toEqual(Array.from(scalarOutput.calmPool));
    expect(Array.from(batchOutput.frost)).toEqual(Array.from(scalarOutput.frost));
    expect(Array.from(batchOutput.dew)).toEqual(Array.from(scalarOutput.dew));
    expect(Array.from(batchOutput.shoreDebris)).toEqual(Array.from(scalarOutput.shoreDebris));
    expect(Array.from(batchOutput.validity)).toEqual(Array.from(scalarOutput.validity));
  });

  it("writes deterministic zeros for non-finite positions without querying authorities", () => {
    const query = makeBatchQuery();
    const output = createEnvironmentalMaskBatchBuffers(2);
    output.riverMist.fill(1);
    evaluateEnvironmentalMaskBatch({
      query,
      settings: cloneEnvironmentalMaskSettings(),
      biome,
      positions: new Float32Array([Number.NaN, 0, 1, Number.POSITIVE_INFINITY]),
      count: 2,
      output,
    });

    expect(Array.from(output.riverMist)).toEqual([0, 0]);
    expect(Array.from(output.validity)).toEqual([0, 0]);
    expect(query.sampleBatch).not.toHaveBeenCalled();
    expect(query.water).not.toHaveBeenCalled();
  });

  it("rejects malformed counts, layouts, positions, and output capacity", () => {
    const base = {
      query: makeQuery(),
      settings: cloneEnvironmentalMaskSettings(),
      biome,
      positions: [0, 0],
      count: 1,
      output: createEnvironmentalMaskBatchBuffers(1),
    };

    expect(() => evaluateEnvironmentalMaskBatch({ ...base, count: -1 })).toThrow(/count/);
    expect(() => evaluateEnvironmentalMaskBatch({ ...base, positionStride: 1 })).toThrow(/stride/);
    expect(() => evaluateEnvironmentalMaskBatch({ ...base, positionOffset: -1 })).toThrow(/offset/);
    expect(() => evaluateEnvironmentalMaskBatch({ ...base, positions: [0] })).toThrow(/positions/);
    expect(() => evaluateEnvironmentalMaskBatch({
      ...base,
      count: 2,
      positions: [0, 0, 1, 1],
      output: createEnvironmentalMaskBatchBuffers(1),
    })).toThrow(/output buffers/);
  });
});

function makeQuery(): EnvironmentQuery {
  const valid = (source: EnvironmentQueryMeta["source"]): EnvironmentQueryMeta => ({
    source,
    revision: 1,
    valid: true,
    cellSizeM: 4,
  });
  return {
    surfaceHeightBestEffort: vi.fn(() => ({ height: 1, meta: valid("live-terrain") })),
    surfaceNormal: vi.fn(() => ({ x: 0, y: 0.9, z: 0, meta: valid("live-terrain") })),
    materialWeights: vi.fn(() => ({ grass: 1, rock: 0, sand: 0, snow: 0, meta: valid("live-terrain") })),
    water: vi.fn(() => ({
      waterY: 2,
      carvedBedY: 1.5,
      depth: 0.5,
      wetMask: 1,
      shoreDistanceM: 3,
      bodyKind: HYDROLOGY_BODY_RIVER,
      bodyId: 1,
      meta: valid("hydrology-atlas"),
    })),
    river: vi.fn(() => ({
      flowX: 1,
      flowZ: 0,
      flowStrength: 0.4,
      bedDrop: 0.6,
      rapidMask: 0.2,
      channelCenterWeight: 0.8,
      bankContactWeight: 0.2,
      gravelBarMask: 0,
      meta: valid("hydrology-atlas"),
    })),
    visibility: vi.fn(() => ({ sunVisibility: 0.6, meta: valid("sun-visibility-cache") })),
  };
}

function makeBatchQuery(): EnvironmentQuery & EnvironmentBatchSampler {
  const query = makeQuery() as EnvironmentQuery & EnvironmentBatchSampler;
  query.sampleBatch = vi.fn((
    input: EnvironmentBatchInput,
    output: EnvironmentBatchOutput,
    options: ResolvedEnvironmentBatchOptions,
  ) => {
    for (let index = 0; index < input.count; index += 1) {
      output.waterY[index] = 2;
      output.carvedBedY[index] = 1.5;
      output.waterDepth[index] = 0.5;
      output.wetMask[index] = 1;
      output.shoreDistanceM[index] = 3;
      output.bodyKind[index] = HYDROLOGY_BODY_RIVER;
      output.bodyId[index] = 1;
      output.flowXZ[index * 2] = 1;
      output.flowXZ[index * 2 + 1] = 0;
      output.flowStrength[index] = 0.4;
      output.bedDrop[index] = 0.6;
      output.rapidMask[index] = 0.2;
      output.channelCenterWeight[index] = 0.8;
      output.bankContactWeight[index] = 0.2;
      output.gravelBarMask[index] = 0;
      output.normalXYZ[index * 3] = 0;
      output.normalXYZ[index * 3 + 1] = 0.9;
      output.normalXYZ[index * 3 + 2] = 0;
      output.sunVisibility[index] = 0.6;
      output.meta.water.valid[index] = 1;
      output.meta.river.valid[index] = 1;
      output.meta.normal.valid[index] = 1;
      output.meta.visibility.valid[index] = 1;
      output.meta.water.cellSizeM[index] = options.sampleHintM;
      output.meta.river.cellSizeM[index] = options.sampleHintM;
      output.meta.normal.cellSizeM[index] = options.sampleHintM;
      output.meta.visibility.cellSizeM[index] = options.sampleHintM;
    }
  });
  return query;
}
