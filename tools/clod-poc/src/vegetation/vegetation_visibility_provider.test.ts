import { describe, expect, it } from "vitest";
import { createVegetationVisibilityProvider, sampleTerrainVisibility, type TerrainHeightSampler } from "./vegetation_visibility_provider.js";

const BASE_QUERY = {
  settings: {
    enabled: true,
    minDistanceM: 10,
    sampleCount: 3,
    heightMarginM: 1,
    crownHeightM: 5,
  },
  cameraX: 0,
  cameraY: 10,
  cameraZ: 0,
  targetX: 100,
  targetZ: 0,
  targetGroundY: 0,
  targetRadiusM: 4,
};

describe("vegetation visibility provider", () => {
  it("keeps clusters visible when disabled", () => {
    const result = sampleTerrainVisibility({
      ...BASE_QUERY,
      settings: { ...BASE_QUERY.settings, enabled: false },
      sampler: highTerrainSampler(100),
    });

    expect(result).toEqual({ visible: true, reason: "disabled", testedSamples: 0 });
  });

  it("keeps near clusters visible", () => {
    const result = sampleTerrainVisibility({
      ...BASE_QUERY,
      targetX: 5,
      sampler: highTerrainSampler(100),
    });

    expect(result.visible).toBe(true);
    expect(result.reason).toBe("near_forced_visible");
  });

  it("keeps unknown terrain visible", () => {
    const result = sampleTerrainVisibility({
      ...BASE_QUERY,
      sampler: { sampleHeight: () => ({ height: 0, unknown: true }) },
    });

    expect(result.visible).toBe(true);
    expect(result.reason).toBe("unknown_kept");
  });

  it("rejects clusters clearly hidden behind terrain", () => {
    const result = sampleTerrainVisibility({
      ...BASE_QUERY,
      sampler: highTerrainSampler(20),
    });

    expect(result.visible).toBe(false);
    expect(result.reason).toBe("terrain_hidden");
  });

  it("keeps clear line-of-sight clusters visible", () => {
    const result = sampleTerrainVisibility({
      ...BASE_QUERY,
      sampler: highTerrainSampler(0),
    });

    expect(result.visible).toBe(true);
    expect(result.reason).toBe("visible");
  });

  it("exposes a reusable cluster provider wrapper", () => {
    const provider = createVegetationVisibilityProvider();

    expect(provider.isClusterVisible({ ...BASE_QUERY, sampler: highTerrainSampler(20) })).toBe(false);
    expect(provider.isClusterVisible({ ...BASE_QUERY, sampler: highTerrainSampler(0) })).toBe(true);
  });
});

function highTerrainSampler(height: number): TerrainHeightSampler {
  return { sampleHeight: () => ({ height }) };
}
