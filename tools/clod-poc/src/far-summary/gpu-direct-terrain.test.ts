import { describe, expect, it } from "vitest";
import { farSummaryGpuUsesCanonicalSamples } from "./gpu-buffers.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";

const sampler: FarTerrainSampler = {
  sampleHeight: () => 42,
  sampleMaterial: () => 1,
};

describe("far-summary direct GPU terrain selection", () => {
  it("avoids CPU canonical terrain sampling for unified infinite-islands", () => {
    expect(farSummaryGpuUsesCanonicalSamples(
      sampler,
      new URLSearchParams("scene=infinite-islands&farSummaryLayout=2"),
    )).toBe(false);
  });

  it("keeps canonical CPU inputs for continent and explicit parity overrides", () => {
    expect(farSummaryGpuUsesCanonicalSamples(
      sampler,
      new URLSearchParams("scene=continent&farSummaryLayout=2"),
    )).toBe(true);
    expect(farSummaryGpuUsesCanonicalSamples(
      sampler,
      new URLSearchParams("scene=infinite-islands&farSummaryLayout=2&farSummaryGpuCanonicalSamples=1"),
    )).toBe(true);
  });

  it("supports an explicit direct-GPU override for diagnostic scenes", () => {
    expect(farSummaryGpuUsesCanonicalSamples(
      sampler,
      new URLSearchParams("scene=continent&farSummaryLayout=2&farSummaryGpuCanonicalSamples=0"),
    )).toBe(false);
    expect(farSummaryGpuUsesCanonicalSamples(undefined, new URLSearchParams())).toBe(false);
  });
});
