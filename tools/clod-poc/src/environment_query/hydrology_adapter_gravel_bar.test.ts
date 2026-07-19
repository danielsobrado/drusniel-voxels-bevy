import { beforeEach, describe, expect, it } from "vitest";
import { cloneHydrologyConfig } from "../water/hydrologyConfig.js";
import { setGravelBarSettings } from "../water/gravel_bar_runtime.js";
import { HYDROLOGY_BODY_RIVER, type HydrologySample } from "../water/hydrologyGrid.js";
import { createEnvironmentBatchOutput, sampleEnvironmentBatch } from "./batch.js";
import { ENVIRONMENT_QUERY_FIELD } from "./constants.js";
import { HydrologyEnvironmentQuery } from "./hydrology_adapter.js";

const sample: HydrologySample = {
  terrainY: 2,
  waterY: 2.5,
  depth: 0.5,
  bodyMask: 1,
  lakeMask: 0,
  riverMask: 1,
  flowX: 1,
  flowZ: 0,
  flowStrength: 0.2,
  riverDepth: 0.5,
  waterYFar: 2.5,
  moisture: 1,
  bodyKind: HYDROLOGY_BODY_RIVER,
  bodyId: 42,
  shoreDistance: 3,
};

beforeEach(() => {
  setGravelBarSettings(cloneHydrologyConfig().gravelBars);
});

describe("hydrology gravel bar query mapping", () => {
  it("matches scalar and batch output at the same world coordinate", () => {
    const query = new HydrologyEnvironmentQuery({
      hydrology: { sample: () => sample },
      nowMs: () => 0,
    });
    const x = -138;
    const z = -38;
    const scalar = query.river(x, z, 16);
    const output = createEnvironmentBatchOutput(1);
    sampleEnvironmentBatch(
      query,
      { positionsXZ: new Float32Array([x, z]), count: 1 },
      output,
      { fieldMask: ENVIRONMENT_QUERY_FIELD.river, sampleHintM: 16 },
    );

    expect(scalar.gravelBarMask).toBeGreaterThan(0.5);
    expect(output.gravelBarMask[0]).toBeCloseTo(scalar.gravelBarMask, 5);
  });
});
