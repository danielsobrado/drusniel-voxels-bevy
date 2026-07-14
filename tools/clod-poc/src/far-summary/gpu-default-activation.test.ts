import { describe, expect, it } from "vitest";
import { farSummaryGpuUsesCanonicalSamples } from "./gpu-buffers.js";
import {
  farSummaryGpuDefaultsForScene,
  farSummaryUnifiedLayoutEnabledForScene,
} from "./gpu-config.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";

const sampler: FarTerrainSampler = {
  sampleHeight: () => 42,
};

describe("default infinite-islands GPU activation", () => {
  it("treats omitted layout as unified for infinite-islands only", () => {
    const infinite = new URLSearchParams("scene=infinite-islands");
    expect(farSummaryUnifiedLayoutEnabledForScene(infinite)).toBe(true);
    expect(farSummaryGpuDefaultsForScene(infinite).authoritative).toBe(true);
    expect(farSummaryGpuUsesCanonicalSamples(sampler, infinite)).toBe(false);

    const continent = new URLSearchParams("scene=continent");
    expect(farSummaryUnifiedLayoutEnabledForScene(continent)).toBe(false);
    expect(farSummaryGpuDefaultsForScene(continent).authoritative).toBe(false);
  });

  it("respects an explicit layout-v1 compatibility override", () => {
    const params = new URLSearchParams("scene=infinite-islands&farSummaryLayout=1");
    expect(farSummaryUnifiedLayoutEnabledForScene(params)).toBe(false);
    expect(farSummaryGpuDefaultsForScene(params).authoritative).toBe(false);
    expect(farSummaryGpuUsesCanonicalSamples(sampler, params)).toBe(true);
  });
});
