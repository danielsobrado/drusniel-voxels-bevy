import { describe, expect, it } from "vitest";
import {
  createEnvironmentBatchOutput,
  ENVIRONMENT_QUERY_FIELD,
  resolveEnvironmentSampleHint,
  sampleEnvironmentBatch,
  type EnvironmentBatchSampler,
} from "./index.js";

describe("environment query batch contract", () => {
  it("preserves a real far-cell sample hint", () => {
    expect(resolveEnvironmentSampleHint(64, 1)).toBe(64);
    expect(resolveEnvironmentSampleHint(undefined, 32)).toBe(32);
  });

  it("falls back for invalid hints without silently forcing one metre", () => {
    expect(resolveEnvironmentSampleHint(0, 24)).toBe(24);
    expect(resolveEnvironmentSampleHint(Number.NaN, 48)).toBe(48);
  });

  it("passes resolved options and caller-owned output to the sampler", () => {
    const output = createEnvironmentBatchOutput(2);
    const seen: { count: number; hint: number; mask: number }[] = [];
    const sampler: EnvironmentBatchSampler = {
      sampleBatch(input, target, options) {
        seen.push({ count: input.count, hint: options.sampleHintM, mask: options.fieldMask });
        target.surfaceHeight[0] = 10;
        target.surfaceHeight[1] = 20;
      },
    };

    sampleEnvironmentBatch(
      sampler,
      { positionsXZ: new Float32Array([0, 1, 2, 3]), count: 2 },
      output,
      { fieldMask: ENVIRONMENT_QUERY_FIELD.surface, sampleHintM: 16 },
    );

    expect(seen).toEqual([{ count: 2, hint: 16, mask: ENVIRONMENT_QUERY_FIELD.surface }]);
    expect(output.count).toBe(2);
    expect(Array.from(output.surfaceHeight)).toEqual([10, 20]);
  });

  it("supports interleaved position buffers", () => {
    const output = createEnvironmentBatchOutput(2);
    const sampler: EnvironmentBatchSampler = {
      sampleBatch(input) {
        expect(input.offset).toBe(1);
        expect(input.stride).toBe(4);
      },
    };

    sampleEnvironmentBatch(
      sampler,
      {
        positionsXZ: new Float32Array([99, 1, 2, 99, 99, 3, 4]),
        count: 2,
        offset: 1,
        stride: 4,
      },
      output,
    );

    expect(output.count).toBe(2);
  });

  it("rejects oversized batches before invoking the sampler", () => {
    let called = false;
    const sampler: EnvironmentBatchSampler = {
      sampleBatch() {
        called = true;
      },
    };

    expect(() => sampleEnvironmentBatch(
      sampler,
      { positionsXZ: new Float32Array([0, 0, 1, 1]), count: 2 },
      createEnvironmentBatchOutput(1),
    )).toThrow(/exceeds output capacity/);
    expect(called).toBe(false);
  });

  it("keeps output count zero when sampling fails", () => {
    const output = createEnvironmentBatchOutput(1);
    const sampler: EnvironmentBatchSampler = {
      sampleBatch() {
        throw new Error("sample failed");
      },
    };

    expect(() => sampleEnvironmentBatch(
      sampler,
      { positionsXZ: new Float32Array([0, 0]), count: 1 },
      output,
    )).toThrow("sample failed");
    expect(output.count).toBe(0);
  });
});
