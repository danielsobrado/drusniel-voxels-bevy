import { describe, expect, it } from "vitest";
import { grassFirstInstanceSmokeRegions } from "./grass_first_instance_smoke.js";

describe("grass firstInstance smoke helpers", () => {
  it("assigns one compact firstInstance region per grass tier", () => {
    const maxInstancesPerTier = 1024;
    const regions = grassFirstInstanceSmokeRegions(maxInstancesPerTier);

    expect(regions.map((region) => [region.tier, region.firstInstance])).toEqual([
      ["near", 0],
      ["mid", maxInstancesPerTier],
      ["far", 2 * maxInstancesPerTier],
      ["super", 3 * maxInstancesPerTier],
    ]);
  });
});
