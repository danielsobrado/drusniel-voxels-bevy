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
import { SunVisibilityEnvironmentQuery } from "./sun_visibility_adapter.js";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "./types.js";

const validMeta: EnvironmentQueryMeta = {
  source: "hydrology-cpu",
  revision: 3,
  valid: true,
  cellSizeM: 8,
};

describe("sun visibility environment query", () => {
  it("overrides scalar visibility with atlas metadata and keeps base fields", () => {
    const base = makeBase();
    const authority = {
      sample: vi.fn(() => ({ visibility: 0.25, valid: true, revision: 9, cellSizeM: 16 })),
    };
    const query = new SunVisibilityEnvironmentQuery({ base, visibility: authority });

    expect(query.water(1, 2, 32)).toEqual({
      waterY: 2,
      carvedBedY: 1.5,
      depth: 0.5,
      wetMask: 1,
      shoreDistanceM: 3,
      bodyKind: 3,
      bodyId: 1,
      meta: validMeta,
    });
    expect(base.water).toHaveBeenCalledWith(1, 2, 32);
    expect(query.visibility(4, 5, 32)).toEqual({
      sunVisibility: 0.25,
      meta: {
        source: "sun-visibility-cache",
        revision: 9,
        valid: true,
        cellSizeM: 16,
      },
    });
    expect(authority.sample).toHaveBeenCalledWith(4, 5, 32);
    expect(base.visibility).not.toHaveBeenCalled();
  });

  it("preserves lit invalid fallback without claiming validity", () => {
    const query = new SunVisibilityEnvironmentQuery({
      base: makeBase(),
      visibility: {
        sample: () => ({ visibility: 0, valid: false, revision: 7, cellSizeM: 0 }),
      },
    });

    expect(query.visibility(0, 0, 24)).toEqual({
      sunVisibility: 1,
      meta: {
        source: "sun-visibility-cache",
        revision: 7,
        valid: false,
        cellSizeM: 24,
      },
    });
  });

  it("replaces only the requested batch visibility field", () => {
    const base = makeBase();
    const authority = {
      sample: vi.fn((x: number) => ({
        visibility: x < 0 ? 1 : 0.4,
        valid: x >= 0,
        revision: 12,
        cellSizeM: 16,
      })),
    };
    const query = new SunVisibilityEnvironmentQuery({ base, visibility: authority });
    const output = createEnvironmentBatchOutput(2);

    sampleEnvironmentBatch(
      query,
      {
        positionsXZ: new Float32Array([1, 2, -1, 4]),
        count: 2,
      },
      output,
      {
        fieldMask: ENVIRONMENT_QUERY_FIELD.water | ENVIRONMENT_QUERY_FIELD.visibility,
        sampleHintM: 32,
      },
    );

    expect(base.sampleBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(base.sampleBatch).mock.calls[0]?.[2].fieldMask).toBe(ENVIRONMENT_QUERY_FIELD.water);
    expect(Array.from(output.waterDepth)).toEqual([0.5, 0.5]);
    expect(Array.from(output.sunVisibility)).toEqual([0.4000000059604645, 1]);
    expect(Array.from(output.meta.visibility.valid)).toEqual([1, 0]);
    expect(Array.from(output.meta.visibility.revision)).toEqual([12, 12]);
    expect(Array.from(output.meta.visibility.cellSizeM)).toEqual([16, 16]);
    expect(base.visibility).not.toHaveBeenCalled();
  });

  it("does not sample visibility when the field is not requested", () => {
    const base = makeBase();
    const authority = { sample: vi.fn(() => ({ visibility: 0, valid: true, revision: 1, cellSizeM: 8 })) };
    const query = new SunVisibilityEnvironmentQuery({ base, visibility: authority });
    const output = createEnvironmentBatchOutput(1);

    sampleEnvironmentBatch(
      query,
      { positionsXZ: new Float32Array([0, 0]), count: 1 },
      output,
      { fieldMask: ENVIRONMENT_QUERY_FIELD.water, sampleHintM: 8 },
    );

    expect(authority.sample).not.toHaveBeenCalled();
    expect(base.sampleBatch).toHaveBeenCalledTimes(1);
  });
});

function makeBase(): EnvironmentQuery & EnvironmentBatchSampler {
  const base: EnvironmentQuery & EnvironmentBatchSampler = {
    surfaceHeightBestEffort: vi.fn(() => ({ height: 1, meta: validMeta })),
    surfaceNormal: vi.fn(() => ({ x: 0, y: 1, z: 0, meta: validMeta })),
    materialWeights: vi.fn(() => ({ grass: 1, rock: 0, sand: 0, snow: 0, meta: validMeta })),
    water: vi.fn(() => ({
      waterY: 2,
      carvedBedY: 1.5,
      depth: 0.5,
      wetMask: 1,
      shoreDistanceM: 3,
      bodyKind: 3,
      bodyId: 1,
      meta: validMeta,
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
      meta: validMeta,
    })),
    visibility: vi.fn(() => ({
      sunVisibility: 1,
      meta: { ...validMeta, source: "fallback", valid: false } satisfies EnvironmentQueryMeta,
    })),
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
  return base;
}
