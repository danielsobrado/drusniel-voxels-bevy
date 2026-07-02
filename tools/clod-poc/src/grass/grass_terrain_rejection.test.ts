import { describe, expect, it } from "vitest";
import type { PageFootprint } from "../types.js";
import { DEFAULT_GRASS_SETTINGS, cloneGrassSettings } from "./grass_config.js";
import { generateGrassInstances } from "./grass_cpu_patch.js";
import type { GrassGenerationStats } from "./grass_stats.js";

function makeStats(): GrassGenerationStats {
  return {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
  };
}

describe("grass terrain rejection", () => {
  it("skips candidate loops when the whole patch is outside grass height range", () => {
    const settings = cloneGrassSettings(DEFAULT_GRASS_SETTINGS);
    settings.minHeight = 10_000;
    settings.placement.minHeightM = 10_000;
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
