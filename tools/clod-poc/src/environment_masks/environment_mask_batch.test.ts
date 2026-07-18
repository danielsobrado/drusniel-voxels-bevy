import { describe, expect, it, vi } from "vitest";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
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

  it("writes deterministic zeros for non-finite positions without querying authorities", () => {
    const query = makeQuery();
    const output = createEnvironmentalMaskBatchBuffers(2);
    output.riverMist.fill(1);
    evaluateEnvironmentalMaskBatch({
      query,
      settings: cloneEnvironmentalMaskSettings(),
      biome,
      positions: [Number.NaN, 0, 1, Number.POSITIVE_INFINITY],
      count: 2,
      output,
    });

    expect(Array.from(output.riverMist)).toEqual([0, 0]);
    expect(Array.from(output.validity)).toEqual([0, 0]);
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
