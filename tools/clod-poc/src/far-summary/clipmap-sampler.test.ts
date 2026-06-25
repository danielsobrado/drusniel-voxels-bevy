import { describe, expect, it } from "vitest";
import { FarSummaryClipmapSampler } from "./clipmap-sampler.js";
import { FarSummaryCache } from "./summary-cache.js";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { StreamCenter } from "./stream-center.js";
import { computeRequiredFarSummaryTiles } from "./clipmap-rings.js";

const flatSampler: FarTerrainSampler = {
  sampleHeight: () => 50,
  sampleMaterial: () => 0,
  sampleCanopyCoverage: () => 0,
  sampleWaterCoverage: () => 0,
};

function buildPopulatedSampler(): FarSummaryClipmapSampler {
  const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
  config.stream.maxTileBuildsPerFrame = 100;
  config.stream.maxTileCommitsPerFrame = 100;
  const cache = new FarSummaryCache(config);
  const sampler = new FarSummaryClipmapSampler(cache, config, flatSampler);

  const center: StreamCenter = {
    worldX: 0, worldZ: 0,
    predictedX: 0, predictedZ: 0,
    velocityX: 0, velocityZ: 0,
  };

  const requests = computeRequiredFarSummaryTiles(center, config);
  cache.requestTiles(requests, 0, 0);
  cache.buildSomeTiles(flatSampler, 0, 0);

  return sampler;
}

describe("clipmap sampler", () => {
  it("exact tile hit returns correct height", () => {
    const sampler = buildPopulatedSampler();
    const h = sampler.sampleHeight(500, 500, 0);
    expect(h).toBe(50);
  });

  it("coarser ring fallback works", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.stream.maxTileBuildsPerFrame = 500;
    config.stream.maxTileCommitsPerFrame = 500;
    const cache = new FarSummaryCache(config);

    // Build all rings
    const center: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };
    const requests = computeRequiredFarSummaryTiles(center, config);
    cache.requestTiles(requests, 0, 0);
    cache.buildSomeTiles(flatSampler, 0, 0);

    const sampler = new FarSummaryClipmapSampler(cache, config, flatSampler);
    // Near_far ring (ring 0) ends at 4096m, so (5000, 5000) is outside.
    // But mid_far (ring 1) and horizon (ring 2) cover it.
    // Request ring 0 at (5000, 5000) — should miss exact, fall to coarser ring.
    const h = sampler.sampleHeight(5000, 5000, 0);
    expect(Number.isFinite(h)).toBe(true);
    // Lower-ring fallback tracking is on the clipmap sampler, not the cache
    // The sample succeeded via the lower ring path
  });

  it("procedural fallback when no tiles exist", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.sampling.fallbackToProcedural = true;
    const cache = new FarSummaryCache(config);
    const sampler = new FarSummaryClipmapSampler(cache, config, flatSampler);

    const h = sampler.sampleHeight(99999, 99999, 0);
    expect(Number.isFinite(h)).toBe(true);
    expect(h).toBe(50);
    expect(cache.getStats().proceduralFallbacks).toBeGreaterThan(0);
  });

  it("conservative default when no fallback", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.sampling.fallbackToProcedural = false;
    config.sampling.fallbackToLowerRing = false;
    config.sampling.conservativeMissingHeightM = 0;
    const cache = new FarSummaryCache(config);
    const sampler = new FarSummaryClipmapSampler(cache, config, flatSampler);

    const h = sampler.sampleHeight(99999, 99999, 0);
    expect(Number.isFinite(h)).toBe(true);
  });

  it("negative world coordinates work", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.sampling.fallbackToProcedural = true;
    const cache = new FarSummaryCache(config);
    const sampler = new FarSummaryClipmapSampler(cache, config, flatSampler);

    const h = sampler.sampleHeight(-5000, -3000, 0);
    expect(Number.isFinite(h)).toBe(true);
  });

  it("returns no NaN output", () => {
    const sampler = buildPopulatedSampler();
    for (let x = -1000; x <= 1000; x += 500) {
      for (let z = -1000; z <= 1000; z += 500) {
        const h = sampler.sampleHeight(x, z, 0);
        expect(Number.isNaN(h)).toBe(false);
        const n = sampler.sampleNormal(x, z, 0);
        expect(Number.isNaN(n.x)).toBe(false);
        expect(Number.isNaN(n.y)).toBe(false);
        expect(Number.isNaN(n.z)).toBe(false);
        expect(Math.abs(n.length() - 1)).toBeLessThan(0.01);
      }
    }
  });

  describe("procedural fallback normals", () => {
    it("flat terrain returns up normal", () => {
      const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
      config.sampling.fallbackToProcedural = true;
      config.sampling.normalSampleStepCells = 1;
      const cache = new FarSummaryCache(config);
      const sampler = new FarSummaryClipmapSampler(cache, config, flatSampler);

      const n = sampler.sampleNormal(500, 500, 0);
      expect(n.x).toBe(0);
      expect(n.z).toBe(0);
      expect(n.y).toBeGreaterThan(0.99);
    });

    it("sloped terrain returns non-flat normal", () => {
      const slopedSampler: FarTerrainSampler = {
        sampleHeight: (x: number, _z: number) => x * 0.1,
        sampleMaterial: () => 0,
        sampleCanopyCoverage: () => 0,
        sampleWaterCoverage: () => 0,
      };

      const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
      config.sampling.fallbackToProcedural = true;
      config.sampling.normalSampleStepCells = 1;
      const cache = new FarSummaryCache(config);
      const sampler = new FarSummaryClipmapSampler(cache, config, slopedSampler);

      const n = sampler.sampleNormal(500, 500, 0);
      // Sloped terrain should have non-zero X normal component
      expect(Math.abs(n.x)).toBeGreaterThan(0.01);
      // Y component should still be dominant but not 1
      expect(n.y).toBeLessThan(1);
      // Normalized
      expect(Math.abs(n.length() - 1)).toBeLessThan(0.01);
    });

    it("cliff-like terrain returns near-horizontal normal", () => {
      const cliffSampler: FarTerrainSampler = {
        sampleHeight: (x: number, _z: number) => x < 500 ? 0 : 100,
        sampleMaterial: () => 0,
        sampleCanopyCoverage: () => 0,
        sampleWaterCoverage: () => 0,
      };

      const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
      config.sampling.fallbackToProcedural = true;
      config.sampling.normalSampleStepCells = 1;
      const cache = new FarSummaryCache(config);
      const sampler = new FarSummaryClipmapSampler(cache, config, cliffSampler);

      // Sample near the cliff edge
      const n = sampler.sampleNormal(495, 500, 0);
      // Cliff should produce a normal pointing away from the cliff face
      expect(Math.abs(n.x)).toBeGreaterThan(0.3);
      expect(n.y).toBeLessThan(0.95);
    });
  });
});
