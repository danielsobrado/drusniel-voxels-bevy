import { describe, expect, it } from "vitest";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import { evaluateGravelBarMask, gravelBarBodyPhase } from "./gravel_bar_field.js";
import {
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_RIVER,
  type HydrologySample,
} from "./hydrologyGrid.js";

function riverSample(overrides: Partial<HydrologySample> = {}): HydrologySample {
  return {
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
    ...overrides,
  };
}

describe("gravel bar field", () => {
  it("is deterministic, bounded, and spatially varied", () => {
    const config = cloneHydrologyConfig().gravelBars;
    const sample = riverSample();
    const first = evaluateGravelBarMask(-138, -38, sample, config);
    expect(first).toBeGreaterThan(0.5);
    expect(evaluateGravelBarMask(-138, -38, sample, config)).toBe(first);
    expect(first).toBeLessThanOrEqual(1);
    expect(evaluateGravelBarMask(-48, 24, sample, config)).not.toBe(first);
  });

  it("fails closed outside valid shallow flowing rivers", () => {
    const config = cloneHydrologyConfig().gravelBars;
    expect(evaluateGravelBarMask(0, 0, riverSample({ bodyKind: HYDROLOGY_BODY_LAKE }), config)).toBe(0);
    expect(evaluateGravelBarMask(0, 0, riverSample({ depth: Number.NaN }), config)).toBe(0);
    expect(evaluateGravelBarMask(0, 0, riverSample({ flowStrength: 0 }), config)).toBe(0);
    expect(evaluateGravelBarMask(0, 0, riverSample({ shoreDistance: 20 }), config)).toBe(0);
  });

  it("derives a stable normalized phase from body identity", () => {
    const first = gravelBarBodyPhase(42);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1);
    expect(gravelBarBodyPhase(42)).toBe(first);
    expect(gravelBarBodyPhase(43)).not.toBe(first);
    expect(gravelBarBodyPhase(0)).toBe(0);
  });
});
