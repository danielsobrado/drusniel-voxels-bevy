import { describe, expect, it } from "vitest";
import { evaluateRevisitEviction, type ResidencySnapshot } from "./revisit_eviction.js";

function snapshot(overrides: Partial<ResidencySnapshot> = {}): ResidencySnapshot {
  return {
    clodCachedKeys: ["L0:-40,0"],
    farSummaryResidentKeys: ["r0_x-8_z0_cs32", "r1_x-2_z0_cs128"],
    heightfieldResidentKeys: ["T:-32,0"],
    vegetationClusterKeys: ["tree:-250,0"],
    waterHydrologyKeys: null,
    ...overrides,
  };
}

describe("revisit eviction evidence", () => {
  it("passes only when named route-A targets are absent before the return leg", () => {
    const evidence = evaluateRevisitEviction(snapshot(), snapshot({
      clodCachedKeys: ["L0:40,0"],
      farSummaryResidentKeys: ["r0_x8_z0_cs32", "r1_x-2_z0_cs128"],
      heightfieldResidentKeys: ["T:31,0"],
      vegetationClusterKeys: ["tree:250,0"],
    }));

    expect(evidence.passed).toBe(true);
    expect(evidence.farSummary.targetKeys).toEqual(["r0_x-8_z0_cs32"]);
    expect(evidence.waterHydrology.available).toBe(false);
  });

  it("fails closed when a target remains resident or a required key contract is missing", () => {
    const evidence = evaluateRevisitEviction(snapshot({ vegetationClusterKeys: null }), snapshot({
      clodCachedKeys: ["L0:-40,0"],
      vegetationClusterKeys: null,
    }));

    expect(evidence.passed).toBe(false);
    expect(evidence.clod.remainingKeys).toEqual(["L0:-40,0"]);
    expect(evidence.failures).toContain("vegetation clusters: stable residency keys are unavailable");
  });
});
