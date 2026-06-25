import { describe, expect, it } from "vitest";
import { COAST_OCEAN_TRANSITION_WGSL } from "./coastOceanTransition.js";

describe("coast ocean transition GPU source", () => {
  it("contains deterministic rounded/noisy coast classification shared by water effects", () => {
    expect(COAST_OCEAN_TRANSITION_WGSL).toContain("fn coast_transition_border");
    expect(COAST_OCEAN_TRANSITION_WGSL).toContain("fn coast_transition_type");
    expect(COAST_OCEAN_TRANSITION_WGSL).toContain("fn coast_transition_primary");
    expect(COAST_OCEAN_TRANSITION_WGSL).toContain("fn coast_transition_secondary");
    expect(COAST_OCEAN_TRANSITION_WGSL).toContain("rectangle_sdf");
    expect(COAST_OCEAN_TRANSITION_WGSL).toContain("near_shore");
  });

  it("uses no time-dependent input for coast identity", () => {
    expect(COAST_OCEAN_TRANSITION_WGSL).not.toContain("time_seconds");
    expect(COAST_OCEAN_TRANSITION_WGSL).not.toContain("collision");
  });
});
