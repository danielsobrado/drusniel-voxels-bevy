import { describe, expect, it } from "vitest";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import { createDeepOceanSampler } from "./ocean_service.js";

describe("createDeepOceanSampler", () => {
  it("samples the same animated wave field used by the render mesh", () => {
    const worldCells = 256;
    const sampler = createDeepOceanSampler(worldCells, DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean);
    const x = worldCells + sampler.startOutsideBorderM + 1;
    const z = worldCells * 0.5;

    const h0 = sampler.sampleOceanHeight(x, z, 0);
    const h1 = sampler.sampleOceanHeight(x, z, 2.5);
    const normal = sampler.sampleOceanNormal(x, z, 0);
    const current = sampler.sampleOceanCurrent(x, z, 0);

    expect(Number.isFinite(h0)).toBe(true);
    expect(Number.isFinite(h1)).toBe(true);
    expect(h0).not.toBe(h1);
    expect(Math.hypot(normal[0], normal[1], normal[2])).toBeCloseTo(1, 5);
    expect(Math.hypot(current[0], current[2])).toBeGreaterThan(0);
  });

  it("does not report gameplay water from the playable world or coast band", () => {
    const worldCells = 256;
    const sampler = createDeepOceanSampler(worldCells, DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean);

    expect(sampler.isInPlayableOcean(worldCells * 0.5, worldCells * 0.5)).toBe(false);
    expect(sampler.isInPlayableOcean(8, worldCells * 0.5)).toBe(false);
    expect(sampler.isInPlayableOcean(worldCells - 8, worldCells * 0.5)).toBe(false);
    expect(sampler.isInPlayableOcean(worldCells + sampler.startOutsideBorderM, worldCells * 0.5)).toBe(false);
    expect(Number.isNaN(sampler.sampleOceanHeight(worldCells * 0.5, worldCells * 0.5, 0))).toBe(true);
    expect(sampler.sampleOceanNormal(worldCells * 0.5, worldCells * 0.5, 0)).toEqual([0, 1, 0]);
    expect(sampler.sampleOceanCurrent(worldCells * 0.5, worldCells * 0.5, 0)).toEqual([0, 0, 0]);
  });
});
