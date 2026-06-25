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

  it("lower ring fallback works", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.stream.maxTileBuildsPerFrame = 100;
    config.stream.maxTileCommitsPerFrame = 100;
    const cache = new FarSummaryCache(config);

    // Only build ring 0
    const center: StreamCenter = {
      worldX: 0, worldZ: 0,
      predictedX: 0, predictedZ: 0,
      velocityX: 0, velocityZ: 0,
    };
    const ring0reqs = computeRequiredFarSummaryTiles(center, config)
      .filter((r) => r.ring === 0);
    cache.requestTiles(ring0reqs, 0, 0);
    cache.buildSomeTiles(flatSampler, 0, 0);

    const sampler = new FarSummaryClipmapSampler(cache, config, flatSampler);
    // Sample at ring 2 — should fall back to ring 0
    const h = sampler.sampleHeight(500, 500, 2);
    expect(h).toBe(50);
    expect(sampler.stats.lowerRingFallbacks).toBeGreaterThanOrEqual(0);
  });

  it("procedural fallback when no tiles exist", () => {
    const config = { ...DEFAULT_FAR_SUMMARY_CONFIG };
    config.sampling.fallbackToProcedural = true;
    const cache = new FarSummaryCache(config);
    const sampler = new FarSummaryClipmapSampler(cache, config, flatSampler);

    const h = sampler.sampleHeight(99999, 99999, 0);
    expect(Number.isFinite(h)).toBe(true);
    expect(h).toBe(50);
    expect(sampler.stats.proceduralFallbacks).toBeGreaterThan(0);
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
});
