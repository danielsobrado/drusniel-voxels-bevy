import { describe, expect, it } from "vitest";
import {
  FLOW_ACCUMULATION_REFERENCE_PARTICLES,
  flowAccumulationThreshold,
} from "./flowAccumulation.js";

const CELL_COUNT = 256 * 256;
const RUNTIME_PARTICLES = 350_000;

describe("flow accumulation thresholds", () => {
  it("preserves Fable threshold ratios at the lower CLOD particle budget", () => {
    for (const thresholdAdd of [14, 320]) {
      const reference = flowAccumulationThreshold(
        FLOW_ACCUMULATION_REFERENCE_PARTICLES,
        CELL_COUNT,
        thresholdAdd,
      );
      const runtime = flowAccumulationThreshold(RUNTIME_PARTICLES, CELL_COUNT, thresholdAdd);
      const referenceRatio = reference / (FLOW_ACCUMULATION_REFERENCE_PARTICLES / CELL_COUNT);
      const runtimeRatio = runtime / (RUNTIME_PARTICLES / CELL_COUNT);

      expect(runtimeRatio).toBeCloseTo(referenceRatio, 10);
    }
  });

  it("always returns a finite positive divisor", () => {
    expect(flowAccumulationThreshold(0, CELL_COUNT, 320)).toBeGreaterThan(0);
    expect(Number.isFinite(flowAccumulationThreshold(0, 0, 320))).toBe(true);
  });
});
