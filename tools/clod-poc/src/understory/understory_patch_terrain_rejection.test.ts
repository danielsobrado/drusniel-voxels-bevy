import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PageFootprint } from "../types.js";
import { DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG } from "../vegetation/terrain_rejection_config.js";
import { DEFAULT_UNDERSTORY_SETTINGS } from "./understory_config.js";
import type { UnderstoryTerrainSampler } from "./understory_instances.js";
import {
  recordUnderstoryEarlyRejection,
  rejectUnderstoryPatchBeforeGeneration,
} from "./understory_patch_terrain_rejection.js";
import { emptyUnderstoryGenerationStats } from "./understory_instances.js";

function makeSampler(height: number, normalY = 1): UnderstoryTerrainSampler {
  return {
    surfaceHeight: () => height,
    surfaceNormal: () => [0, normalY, 0],
    materialWeights: () => [1, 0, 0, 0],
  };
}

beforeEach(resetTerrainRejectionConfig);
afterEach(resetTerrainRejectionConfig);

describe("understory patch terrain rejection", () => {
  it("keeps probe-only static rejection disabled by default", () => {
    const footprint: PageFootprint = { minX: 10, minZ: 10, maxX: 26, maxZ: 26 };
    const decision = rejectUnderstoryPatchBeforeGeneration(
      footprint,
      DEFAULT_UNDERSTORY_SETTINGS,
      makeSampler(DEFAULT_UNDERSTORY_SETTINGS.placement.maxHeightM + 100),
      512,
    );

    expect(decision.reject).toBe(false);
    expect(decision.reason).toBe("disabled");
  });

  it("rejects full patches when opted in and height is outside range", () => {
    DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.enabled = true;
    DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled = true;
    const footprint: PageFootprint = { minX: 10, minZ: 10, maxX: 26, maxZ: 26 };
    const decision = rejectUnderstoryPatchBeforeGeneration(
      footprint,
      DEFAULT_UNDERSTORY_SETTINGS,
      makeSampler(DEFAULT_UNDERSTORY_SETTINGS.placement.maxHeightM + 100),
      512,
    );

    expect(decision.reject).toBe(true);
    expect(decision.reason).toBe("height_range");
    expect(decision.skippedCandidateEstimate).toBeGreaterThan(0);
  });

  it("records skipped patch candidate estimates", () => {
    const stats = emptyUnderstoryGenerationStats();

    recordUnderstoryEarlyRejection(stats, {
      reject: true,
      reason: "too_steep",
      skippedCandidateEstimate: 14,
    });

    expect(stats.earlyTerrainRejectedPatches).toBe(1);
    expect(stats.earlyTerrainSkippedCandidates).toBe(14);
    expect(stats.earlyTerrainReasonCounts?.too_steep).toBe(1);
  });
});

function resetTerrainRejectionConfig(): void {
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.enabled = false;
  DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled = false;
}
