import { describe, expect, it } from "vitest";
import { relocateProbeGiPosition } from "./relocation.js";

const config = {
  enabled: true,
  maximumSpacingFraction: 0.45,
  invalidAfterFailedAxes: 6,
} as const;

describe("probe GI relocation", () => {
  it("keeps a free probe unchanged", () => {
    const result = relocateProbeGiPosition([1, 2, 3], 4, { densityAt: () => -1 }, config);
    expect(result).toMatchObject({ valid: true, relocated: false, position: [1, 2, 3] });
  });

  it("escapes along the least-penetrating axis within 45 percent of spacing", () => {
    const result = relocateProbeGiPosition(
      [0, 0, 0],
      4,
      { densityAt: (x) => 0.5 - x },
      config,
    );
    expect(result.valid).toBe(true);
    expect(result.relocated).toBe(true);
    expect(result.offset).toEqual([1.8, 0, 0]);
    expect(result.position[0]).toBeCloseTo(1.8);
  });

  it("invalidates a fully enclosed probe instead of injecting sky", () => {
    const result = relocateProbeGiPosition([0, 0, 0], 4, { densityAt: () => 1 }, config);
    expect(result.valid).toBe(false);
    expect(result.unknown).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("keeps unknown solid data distinct from a confirmed enclosure", () => {
    const result = relocateProbeGiPosition([0, 0, 0], 4, { densityAt: () => null }, config);
    expect(result.valid).toBe(false);
    expect(result.unknown).toBe(true);
  });
});
