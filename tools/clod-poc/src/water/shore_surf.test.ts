import { describe, expect, it } from "vitest";
import { createDeepOceanSampler } from "./ocean_service.js";

describe("deep ocean sampler boundary", () => {
  it("treats only positions outside the playable world as future boat ocean", () => {
    const sampler = createDeepOceanSampler(256, {
      enabled: true,
      extendCells: 64,
      surfaceY: 18,
      segments: 8,
    });

    expect(sampler.isInPlayableOcean(300, 128)).toBe(true);
    expect(sampler.isInPlayableOcean(8, 128)).toBe(false);
    expect(sampler.isInPlayableOcean(128, 128)).toBe(false);
    expect(Number.isFinite(sampler.sampleOceanHeight(300, 128, 1))).toBe(true);
    expect(Number.isNaN(sampler.sampleOceanHeight(8, 128, 1))).toBe(true);
  });
});
