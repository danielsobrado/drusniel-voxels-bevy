import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PageFootprint } from "../types.js";
import { DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG } from "../vegetation/terrain_rejection_config.js";
import { DEFAULT_GRASS_SETTINGS, cloneGrassSettings } from "./grass_config.js";
import { clearGrassTerrainRejectionCache, generateGrassInstances } from "./grass_cpu_patch.js";
import type { GrassGenerationStats } from "./grass_stats.js";

function makeStats(): GrassGenerationStats {
  return {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
  };
}

beforeEach(() => {
  resetTerrainRejectionConfig();
  clearGrassTerrainRejectionCache();
});
afterEach(resetTerrainRejectionConfig);

describe("grass terrain rejection", () => {
  it("keeps probe-only static rejection disabled by default", () => {
    const settings = cloneGrassSettings(DEFAULT_GRASS_SETTINGS);
    settings.minHeight = 10_000;
    settings.placement.minHeightM = 10_000;
    const stats = makeStats();
    const footprint: PageFootprint = { minX: 32, minZ: 32, maxX: 48, maxZ: 48 };

    generateGrassInstances(footprint, settings, settings.maxBlades, stats);

    expect(stats.earlyTerrainRejectedPatches ?? 0).toBe(0);
  });

  it("skips candidate loops when opted in and the whole patch is outside grass height range", () => {
    DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.enabled = true;
    DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled = true;
    const settings = cloneGrassSettings(DEFAULT_GRASS_SETTINGS);
    settings.minHeight = 10_000;
    settings.placement.minHeightM = 10_000;
    settings.slopeMinY = 0;
    const stats = makeStats();
    const footprint: PageFootprint = { minX: 32, minZ: 32, maxX: 48, maxZ: 48 };

    const instances = generateGrassInstances(footprint, settings, settings.maxBlades, stats);

    expect(instances).toHaveLength(0);
    expect(stats.generatedCandidates).toBe(0);
    expect(stats.earlyTerrainRejectedPatches).toBe(1);
    expect(stats.earlyTerrainSkippedCandidates).toBeGreaterThan(0);
    expect(stats.earlyTerrainReasonCounts?.height_range).toBe(1);
  });
});

function resetTerrainRejectionConfig(): void {
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.enabled = false;
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled = false;
}
